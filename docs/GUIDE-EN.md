# Italian live TV on Jellyfin with the IPTV-Italia Plus playlist

_Updated October 31, 2026_

## Overview

These six steps give you more than 70 Italian free-to-air channels in Jellyfin (RAI, Mediaset, La7, Discovery, theme channels and radio-TV) with a TV guide, using Tundrak's `iptvitaplus.m3u` playlist.

The playlist has no link to a TV guide and uses four kinds of stream, each with different needs:

| Group | Examples | Stream type | What it needs |
| --- | --- | --- | --- |
| RAI | Rai 1, Rai 2, Rai 3, Rai News 24 | mediapolis.rai.it relinker, then HLS | Italian IP and User-Agent `HbbTV/1.6.1` |
| Mediaset | Rete 4, Canale 5, Italia 1, TGCOM 24 | Unencrypted DASH (`.mpd`) | User-Agent `HbbTV/1.6.1` |
| Discovery, La7 and others | NOVE, Real Time, DMAX, La7, TV2000 | HLS (`.m3u8`) | Nothing special |
| Free-to-air Sky | TV8, Cielo, Sky TG24 | HLS with a token | The token expires: the link is refreshed in Step 1 |

Requirements:

- Jellyfin 10.9 or later (option names vary slightly between versions)
- A server that reaches the internet with an Italian IP, required for the RAI channels
- A public GitHub repository and, on your computer, Docker (or Node.js 18+ and yt-dlp) to generate the playlist in Step 1
- Optional: Docker on your computer to check the TV guide in Step 3 (GitHub Actions generates it for you)
- Optional: Docker for Threadfin in Step 6

## Step 1 — Generate the playlist on your computer

The generator downloads Tundrak's playlist, refreshes the TV8, Cielo and Sky TG24 links with yt-dlp, tries every link with the same User-Agent as Jellyfin (`HbbTV/1.6.1`) and writes the result to `public/iptvitaplus.m3u` in your GitHub repository. You run it by hand whenever you want to update the playlist.

Run it from an Italian network, ideally the same one as your Jellyfin server: Sky live streams are only available from Italy.

**A. Set up the repository** (once). The repository is [valeriocomo/iptv-it](https://github.com/valeriocomo/iptv-it) and it must be public. Clone it on your computer:

```bash
git clone https://github.com/valeriocomo/iptv-it.git
```

**B. Set up the generator** (once). Put the `packages/playlist` folder (`Dockerfile`, `entrypoint.sh`, `generate-playlist.js`), the file `compose.yml` and `README.md` in the repository clone. `compose.yml` mounts its own folder, and the playlist is written to `public/iptvitaplus.m3u`, with the same name as Tundrak's file; the `public` folder is created if missing. Then build the image:

```bash
docker compose build
```

**C. Generate the playlist** (every time you want to update it):

```bash
docker compose run --rm playlist-generator
```

Each run also updates yt-dlp and ends with a summary, for example "Done: 71 channels written (Sky: 3 updated, 0 not updated)".

| Message | Meaning |
| --- | --- |
| `Updated: TV8` | Sky link refreshed |
| `  reason: ERROR: …` | Under each "Not updated" line: the error reported by yt-dlp |
| `Replaced: NOVE (ENOTFOUND) -> https://… [iptv-org]` | Tundrak's link does not answer: it was replaced with a working official one (`[RAI relinker]` or `[iptv-org]`) |
| `Not working, no official alternative found` | Channels whose link does not answer and that have no working official alternative; kept in the playlist, or removed with `REMOVE_NOT_WORKING=1` |
| `… unofficial alternative(s) ignored` | iptv-org had links for the channel, but only on third-party rebroadcast servers |
| `Links: 60 working, 8 replaced, 3 not working` | Summary of the link check |
| `Not updated: … (keeping the link from the previous run)` | yt-dlp found no new link: the one from the previous run is kept |
| `Not updated: … (keeping the link from the upstream playlist)` | No new or previous link: that channel probably does not work |
| `Error: … The output file was not changed.` | Download or yt-dlp failed: the file was not touched |

Tundrak's list is no longer maintained and many links have changed. That is why the generator opens every link the way Jellyfin would: if it does not answer with an HLS or DASH stream within 10 seconds, it looks for a working official alternative. For RAI channels it tries the same relinker without the old parameters, which now answer 503; for the others it looks in the [iptv-org](https://github.com/iptv-org/iptv) list, checked daily, skipping third-party rebroadcasts: servers on bare IP addresses or non-standard ports, and servers that carry channels of different broadcasters (for example La7 and RAI together), since an official server only carries its own broadcaster's channels. If a channel passes the check but Jellyfin still cannot play it, the problem is in Jellyfin (User-Agent, FFmpeg), not in the link.

yt-dlp support is confirmed for the TV8 live stream; Cielo and Sky TG24 are not verified. If they stay "Not updated", those channels are still available over digital terrestrial TV (channels 26 and 50).

On Linux the container writes the file as user 1000. If `id -u` returns a different number, run it like this:

```bash
PUID=$(id -u) PGID=$(id -g) docker compose run --rm playlist-generator
```

Without Docker you need Node.js 18 or later and yt-dlp (`pip install -U yt-dlp`); then, from the clone folder, run `node packages/playlist/generate-playlist.js public` (or `npm run start -w @iptv-it/playlist`).

## Step 1b — Publish the playlist on GitHub

After each run you push the file to the repository, and Jellyfin reads it from its public link.

```bash
cd iptv-it
git add public/iptvitaplus.m3u
git commit -m "Update playlist"
git pull --rebase
git push
```

If `git commit` replies "nothing to commit", the playlist has not changed and there is nothing to publish. `git pull --rebase` first fetches the guide updates that GitHub Actions commits to the repository (Step 3); without it the push may be refused.

The address to give Jellyfin is the file's raw URL:

```
https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/iptvitaplus.m3u
```

Open it in a browser to check: it should show the playlist text. GitHub caches the file for about 5 minutes, so after a push changes may take a few minutes to show up.

The repository is public: anyone can see the playlist, Sky links with their tokens included.

## Step 2 — Add the M3U tuner

The key setting is the User-Agent `HbbTV/1.6.1`: without it, RAI and Mediaset refuse the connection.

1. Open **Dashboard → Live TV**.
2. Next to **Tuner Devices**, click **+**.
3. Fill in the fields as follows:

| Field | Value | Notes |
| --- | --- | --- |
| Tuner type | M3U Tuner | |
| File or URL | `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/iptvitaplus.m3u` | The raw URL from Step 1b |
| User agent | `HbbTV/1.6.1` | Applies to all channels; harmless for the others |
| Simultaneous stream limit | 0 | 0 = no limit |
| Allow stream sharing | On | Several devices on the same channel share one stream |
| Ignore DTS timestamps | Off | Turn it on only if you see stuttering or audio out of sync |
| Read input at native frame rate | Off | |

4. Click **Save**. The channels show up under Live TV after a few seconds.

Jellyfin does not reliably apply the per-channel `#EXTVLCOPT` lines, which is why the User-Agent goes in the tuner settings. If your version has no User agent field, go straight to Step 6.

## Step 3 — Generate the TV guide

The guide generator reads the playlist from Step 1, matches each channel to an Italian iptv-org/epg source and writes `public/guide.xml`. A GitHub Action runs it on GitHub's servers and publishes the guide on its own (C); on your computer you run it in Docker only to check the result.

In the guide every channel has the same ID as in the playlist (`Rai1.it`, `Canale5.it`…), so Jellyfin matches them on its own. The matching is needed because iptv-org now uses different IDs, such as `Rai1.it@SD`.

**A. Set up the generator** (once, only to run it on your computer). The generator lives in the repository's `packages/epg` folder (`Dockerfile`, `entrypoint.sh`, `generate-epg.js`) and is the `epg-generator` service in `compose.yml`. Build the image:

```bash
docker compose build epg-generator
```

**B. Generate the guide on your computer** (optional, to check it), always after the playlist:

```bash
docker compose run --rm playlist-generator
docker compose run --rm epg-generator
```

Alternatively, with Node.js installed: `npm run start -w @iptv-it/epg`. The script rebuilds the image, then runs the same service as your user.

On Linux, if `id -u` does not return 1000, prefix both commands with `PUID=$(id -u) PGID=$(id -g)`, as in Step 1.

Each run updates the iptv-org/epg site parsers, which change often; the download takes a few minutes. The summary lists the matched channels with the source of each one, for example `Rai1.it <- raiplay.it "RAI 1" (by id)`, then the channels with no source. If the download returns no programmes, `public/guide.xml` is not touched.

| Source | Channels |
| --- | --- |
| raiplay.it | RAI channels |
| mediasetinfinity.mediaset.it | Mediaset channels |
| superguidatv.it | La7, Discovery, free-to-air Sky and the rest |

With the current playlist, 58 of 71 channels are matched; the other 13 are radio-TV and minor channels the sources do not cover (BOM Channel, Padre Pio TV, Byoblu, RTV San Marino and similar). Matched does not mean with programmes, though: in the guide generated on October 31, 2026 superguidatv.it returned nothing, and only RAI and Mediaset have programmes (25 channels). If that happens to you too, change the source order with the `SITES` variable (below), putting guidatv.sky.it and guida.tv before superguidatv.it.

To check the matching without downloading anything:

```bash
docker compose run --rm epg-generator --match-only
```

**C. Publish it.** The repository's GitHub Action (`.github/workflows/epg.yml`) does it for you: every 6 hours, and whenever you push a change to the playlist, `compose.yml` or the `packages/epg` folder, it regenerates the guide on GitHub's servers and commits `public/guide.xml` only if it changed. The sources provide 2 or 3 days of programmes, so without these updates the guide would run empty in Jellyfin.

Do not commit the guide generated on your computer: discard it with `git checkout public/guide.xml`, since the action would replace it at its next run anyway. To update the guide right away, open the repository's **Actions** tab → **Update TV guide** → **Run workflow**.

If the new guide has less than half the programmes of the one in the repository (for example because a source answers worse from GitHub's servers, which are not in Italy), the action does not commit it and the run fails with an error in the **Actions** tab. To publish it anyway, start it by hand with **force** ticked.

**D. Add it to Jellyfin:**

1. **Dashboard → Live TV → TV Guide Data Providers → + → XMLTV**.
2. In **File or URL** enter `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/guide.xml`.
3. Enable the provider for the tuner created in Step 2 and save.

To change the behaviour, add the variables to the `environment` section of the `epg-generator` service in `compose.yml` (`DAYS` and `MAX_CONNECTIONS` are already there, commented out). The action uses the same `compose.yml`, so once pushed the changes apply to it too:

| Variable | Default | Description |
| --- | --- | --- |
| `DAYS` | each source's own (2–3) | Days of programmes to download |
| `MAX_CONNECTIONS` | `5` | Parallel requests to the guide sites |
| `SITES` | `raiplay.it,mediasetinfinity.mediaset.it,superguidatv.it,guidatv.sky.it,guida.tv` | Sources to use, in order of preference |

For example, to prefer guidatv.sky.it over superguidatv.it:

```yaml
      - SITES=raiplay.it,mediasetinfinity.mediaset.it,guidatv.sky.it,guida.tv,superguidatv.it
```

## Step 4 — Refresh the guide and map the channels

Jellyfin matches channels to the guide by `tvg-id` on its own; you map the ones left without programmes by hand.

1. Go to **Dashboard → Scheduled Tasks**, find **Refresh Guide** and run it. The first run can take a few minutes.
2. Open the TV guide from a client: channels with programmes are already matched.
3. For the others, go back to **Dashboard → Live TV**, open the menu (⋮) of the XMLTV provider and choose **Map Channels**.
4. Match each playlist channel to its guide entry, save and run **Refresh Guide** again.

Radio-TV channels and some theme channels may have no guide: that is normal and does not affect playback.

## Step 5 — Test the key channels

Four channels are enough to tell whether the whole setup works; test them in this order.

| Order | Channel | What it checks | If it does not play |
| --- | --- | --- | --- |
| 1 | La7 | The tuner reads the playlist | Check in the Step 1 summary whether the link is working or was replaced; then open the raw URL in a browser and check that the repository is public (Step 1b) |
| 2 | NOVE | Regular HLS streams | Regenerate and republish the playlist: the generator replaces links that do not answer |
| 3 | Canale 5 | Mediaset DASH streams and User-Agent | Check the User-Agent, then go to Step 6 |
| 4 | Rai 1 | RAI relinker, Italian IP and User-Agent | Regenerate the playlist; if it stays under "Not working", check the server's IP, then go to Step 6 |

To find out whether the RAI problem is the IP, run this command from the server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L -A "HbbTV/1.6.1" \
  "http://mediapolis.rai.it/relinker/relinkerServlet.htm?cont=2606803&output=7&forceUserAgent=raiplayappletv"
```

If it returns `200`, the stream is reachable and the problem is in Jellyfin. If it returns `403`, the server does not have an Italian IP or RAI has changed something.

## Step 6 (optional) — Threadfin as a middleman

If RAI or Mediaset still do not play with the right User-Agent, Threadfin sits between the playlist and Jellyfin and handles the streams itself with FFmpeg and a buffer. Jellyfin sees it as an HDHomeRun tuner.

**A. Start Threadfin** with this `docker-compose.yml`:

```yaml
services:
  threadfin:
    image: fyb3roptik/threadfin:latest
    container_name: threadfin
    ports:
      - "34400:34400"
    volumes:
      - ./threadfin/conf:/home/threadfin/conf
    environment:
      - TZ=Europe/Rome
    restart: unless-stopped
```

```bash
docker compose up -d
```

**B. Configure it** from the web interface at `http://<ip>:34400/web`:

1. In the setup wizard, choose **HDHomeRun** as the tuner type.
2. Under **Playlist**, add `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/iptvitaplus.m3u`.
3. Under **XMLTV**, add `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/guide.xml`.
4. Under **Settings**, set the buffer to **FFmpeg** and the User-Agent to `HbbTV/1.6.1`.
5. Under **Mapping**, enable the channels you want and assign each one its guide entry.

**C. Connect it to Jellyfin:**

1. In **Dashboard → Live TV**, remove the M3U tuner from Step 2 and the XMLTV provider from Step 3.
2. Add a tuner of type **HDHomeRun** with address `http://<ip>:34400`.
3. Add an **XMLTV** provider with Threadfin's guide URL: `http://<ip>:34400/xmltv/threadfin.xml`.
4. Run **Refresh Guide** again.

The exact names of Threadfin's menu items may vary slightly between versions.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No channels under Live TV | Jellyfin cannot download the playlist | Open the raw URL in a browser: it must show the playlist, and the repository must be public |
| Jellyfin still shows the old links | GitHub cache, or the playlist was not re-read | Wait 5 minutes after the push, then run **Refresh Guide** |
| Only RAI channels do not play | Non-Italian IP or missing User-Agent | Run the `curl` test from Step 5, then try Threadfin |
| Only Mediaset channels do not play | Jellyfin's FFmpeg struggles with DASH streams | Threadfin with the FFmpeg buffer (Step 6) |
| Channels start, then freeze after a few seconds | Irregular stream timestamps | Turn on **Ignore DTS timestamps**; if that is not enough, Threadfin |
| Empty guide | Guide not refreshed or different `tvg-id` values | Run **Refresh Guide** and map by hand (Step 4) |
| Guide not updated for more than 6 hours | The GitHub Action failed or was disabled | In the **Actions** tab, read the error of the last **Update TV guide** run, or enable the workflow again |
| A single channel stops working | The broadcaster changed the link | Regenerate and republish the playlist (Steps 1 and 1b) |
| TV8, Cielo or Sky TG24 do not play | Expired token or no new link from yt-dlp | Regenerate the playlist; if it stays "Not updated", use digital terrestrial TV |

## Sources

- [IPTV-Italia Plus playlist (Tundrak)](https://raw.githubusercontent.com/Tundrak/IPTV-Italia/main/iptvitaplus.m3u)
- [Reports of 403 errors on the RAI channels](https://github.com/Tundrak/IPTV-Italia/issues/119)
- [iptv-org/epg, the TV guide tool](https://github.com/iptv-org/epg)
- [Jellyfin Live TV & IPTV Setup 2026 (JellyWatch)](https://jellywatch.app/blog/jellyfin-live-tv-iptv-setup-guide-2026)
- [Jellyfin Live TV without a hardware tuner: Threadfin and Dispatcharr (JellyWatch)](https://jellywatch.app/blog/jellyfin-m3u-tuner-live-tv-without-hardware-threadfin-dispatcharr-2026)
- [Jellyfin forum: incompatible IPTV streams and proxies](https://forum.jellyfin.org/printthread.php?tid=10304)