#!/bin/sh
# Runs once: updates yt-dlp, then generates the playlist and exits.

echo "Updating yt-dlp..."
pip install -q -U --no-cache-dir yt-dlp \
  || echo "yt-dlp update failed, using the installed version"

exec node /app/generate-playlist.js "$OUTPUT_DIR" "$@"
