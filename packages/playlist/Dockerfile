# Builds the Italian IPTV playlist: upstream playlist + refreshed Sky links.
FROM node:26-alpine

# Python is needed by yt-dlp. The venv is writable by any user, so
# yt-dlp can update itself even when the container runs as your user.
RUN apk add --no-cache python3 \
 && python3 -m venv /opt/yt \
 && /opt/yt/bin/pip install --no-cache-dir yt-dlp \
 && chmod -R a+rwX /opt/yt

ENV PATH="/opt/yt/bin:$PATH" \
    HOME=/tmp \
    OUTPUT_DIR=/data/public

WORKDIR /app
COPY generate-playlist.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

# mount your repository clone here
VOLUME /data

ENTRYPOINT ["/app/entrypoint.sh"]
