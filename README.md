# playlist-generator

Generates an Italian free-to-air IPTV playlist for Jellyfin, ready to publish on GitHub.

Each run:

1. downloads the upstream playlist from [Tundrak/IPTV-Italia](https://github.com/Tundrak/IPTV-Italia) (`iptvitaplus.m3u`);
2. refreshes the TV8, Cielo and Sky TG24 links with [yt-dlp](https://github.com/yt-dlp/yt-dlp), since Sky links carry a token that expires;
3. writes the result to `public/`, keeping the upstream file name (`public/iptvitaplus.m3u`).

Nothing runs automatically: you start it by hand, then commit and push the file yourself.

## Requirements

- Docker with Compose.
- An Italian IP address: Sky live streams are geo-blocked outside Italy. Run it from the same network as your Jellyfin server if you can.
- A public GitHub repository, cloned on your computer.

## Files

| File | Purpose |
| --- | --- |
| `generate.js` | Downloads the upstream playlist, refreshes the Sky links, writes the output |
| `entrypoint.sh` | Updates yt-dlp, then runs `generate.js` once |
| `Dockerfile` | Node.js 26 on Alpine, with Python and yt-dlp |
| `compose.yml` | Mounts your repository clone and runs the container |

## Setup

1. Put these files in your repository clone. `compose.yml` mounts its own folder (`.`) as `/data`, so the playlist is written to `public/` inside it (the folder is created if missing). If you keep the files elsewhere, replace `.` with the absolute path of your clone.
2. Build the image:

   ```bash
   docker compose build
   ```

## How to run

```bash
docker compose run --rm playlist-generator
```

On Linux the file is written as user `1000:1000`. If `id -u` returns a different number, run:

```bash
PUID=$(id -u) PGID=$(id -g) docker compose run --rm playlist-generator
```

### Output

| Message | Meaning |
| --- | --- |
| `Updated: TV8` | Sky link refreshed |
| `Not updated: … (keeping the link from the previous run)` | yt-dlp found no new link; the one from the last run is kept |
| `Not updated: … (keeping the link from the upstream playlist)` | No new link and no previous run; the channel probably does not work |
| `Error: … The output file was not changed.` | Download failed or yt-dlp is missing; the file was not touched |

yt-dlp support is confirmed for the TV8 live stream; Cielo and Sky TG24 are not verified.

## Publish

```bash
cd /path/to/your/repo
git add public/iptvitaplus.m3u
git commit -m "Update playlist"
git push
```

If `git commit` says "nothing to commit", the playlist did not change.

## Use in Jellyfin

In **Dashboard → Live TV → Tuner Devices**, add an **M3U Tuner** with:

- **File or URL:** `https://raw.githubusercontent.com/<user>/<repo>/main/public/iptvitaplus.m3u`
- **User agent:** `HbbTV/1.6.1` (required by the RAI and Mediaset streams)

GitHub caches raw files for about 5 minutes, so changes may take a few minutes to show up after a push.

## Without Docker

With Node.js 18+ and yt-dlp installed (`pip install -U yt-dlp`):

```bash
node generate.js /path/to/your/repo/public
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OUTPUT_DIR` | `/data/public` | Output folder inside the container |
| `SOURCE_URL` | Tundrak `iptvitaplus.m3u` | Upstream playlist to start from; its file name is used for the output |
| `PUID` / `PGID` | `1000` | User and group that own the generated file (Linux) |

## Notes

- The repository is public: anyone can see the playlist, Sky links with their tokens included.
- If a Sky channel stays "Not updated", it is still available over digital terrestrial TV (Cielo on 26, Sky TG24 on 50).