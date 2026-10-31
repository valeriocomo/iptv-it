# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A manual, run-once tool that builds an Italian free-to-air IPTV playlist (`iptvitaplus.m3u`, written to `public/`) for Jellyfin. It downloads the upstream playlist (Tundrak/IPTV-Italia `iptvitaplus.m3u`), replaces the TV8, Cielo and Sky TG24 links with fresh ones from yt-dlp (Sky links carry expiring tokens), and writes the result into a separate, locally cloned public GitHub repo. The user commits and pushes that file by hand; only the guide (`public/guide.xml`) is regenerated and committed automatically, by GitHub Actions. There is no build step and no tests: plain Node.js with no runtime dependencies. The two generators are npm workspaces (`packages/*`: `@iptv-it/playlist` and `@iptv-it/epg`; select them with `-w` and the scoped name or the folder path, not the bare folder name); their `package.json` files hold only metadata and scripts. The root `package.json` (`iptv-it`) declares the workspaces and holds ESLint as a dev dependency (`eslint.config.mjs`, CommonJS + Node globals). The Docker images copy just their own `.js`/`.sh` files, not the `package.json`.

## Commands

```bash
docker compose build                              # build the image
docker compose run --rm playlist-generator        # generate once (set PUID/PGID if your uid is not 1000)
node packages/playlist/generate-playlist.js /path/to/repo/public # without Docker (Node 18+ and yt-dlp required)
npm run start -w @iptv-it/playlist                # same, writing to the repo's public/
npm run diagnose -w @iptv-it/playlist             # generate-playlist.js --diagnose
npm run start -w @iptv-it/epg                     # epg-generator via docker compose (rebuilds the image first)
npm run match-only -w @iptv-it/epg                # same, with --match-only
npm run lint                                      # ESLint on the scripts (after npm install)
actionlint                                        # check .github/workflows (uses shellcheck for run: scripts)
```

`.devcontainer/devcontainer.json` provides all of the above: Node 26, Docker-in-Docker (so the `.:/data` bind mount in `compose.yml` works unchanged), yt-dlp, actionlint, shellcheck, Claude Code, the GitHub CLI, and the VS Code extensions for Dockerfiles, ESLint and workflows. Its `postCreateCommand` runs `npm install`. `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` are passed in from the host environment (`remoteEnv`).

`compose.yml` mounts its own folder (`.`) as `/data`, so the output goes to `public/` there; use an absolute path if the files live outside the clone. Sky streams are geo-blocked, so a real run needs an Italian IP.

npm runs workspace scripts with the package folder as the working directory, so any path in a workspace script is relative to `packages/<name>/` (hence `../../public`). `public/` and `compose.yml` stay at the repository root: the Jellyfin URLs point at `public/`, and the `.:/data` mount depends on where `compose.yml` is.

## Architecture

- `packages/playlist/generate-playlist.js` is the real entry point. `main()` checks yt-dlp exists, downloads and validates the source (`#EXTM3U`), and parses it into a header and channel blocks (`#EXTINF` line, optional `#` option lines, link as the last line). For each channel whose `tvg-id` is in `SKY_CHANNELS` it calls `fetchNewLink`, which tries `yt-dlp -g -f b` and then `yt-dlp -g`. If both fail, it keeps the link from the previous output file, or the upstream link if there was none. Any fatal error exits 1 before the output is written, so a failed run never changes the file.
- `packages/epg/` is the same layout for the guide (`Dockerfile`, `entrypoint.sh`, `generate-epg.js`, service `epg-generator`): it builds `public/guide.xml` for the playlist channels with iptv-org/epg.
- `.github/workflows/epg.yml` runs the `epg-generator` service on GitHub every 6 hours, by hand, and on pushes to `main` that touch the playlist, `compose.yml` or `packages/epg/`. It commits `public/guide.xml` as `github-actions[bot]` only when `git diff` shows a change, and fails without committing if the programme count drops below half of the committed one (unless started by hand with `force`).
- `packages/playlist/entrypoint.sh` is the container entrypoint: it upgrades yt-dlp (non-fatal on failure), then `exec`s `generate-playlist.js "$OUTPUT_DIR"`.
- `packages/playlist/Dockerfile` installs yt-dlp in a venv at `/opt/yt` that is world-writable, so the self-update works when the container runs as a non-root `PUID:PGID`. `HOME=/tmp` for the same reason.

## Things to keep in mind

- To add or change a refreshed channel, edit `SKY_CHANNELS` (tvg-id to official live page) in `packages/playlist/generate-playlist.js`.
- The `README.md` documents the console messages (`Updated:`, `Not updated:`, `Error:`) and the env vars (`OUTPUT_DIR`, `SOURCE_URL`, `PUID`/`PGID`). Update it if you change them.
- Jellyfin needs the user agent `HbbTV/1.6.1` for the RAI and Mediaset streams. This is configured in Jellyfin, not in this repo.
