# Builds the XMLTV guide for the playlist channels with iptv-org/epg.
# Upstream iptv-org/epg uses Node 22; if Node 26 gives problems, build with
#   docker compose build --build-arg NODE_VERSION=22 epg-generator
ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-alpine

ARG EPG_REF=master

# The iptv-org/epg folder is writable by any user, so the site parsers can
# be updated at each run even when the container runs as your user.
RUN apk add --no-cache git tzdata \
 && git config --system --add safe.directory '*' \
 && git clone --depth 1 -b "$EPG_REF" https://github.com/iptv-org/epg.git /opt/epg \
 && cd /opt/epg \
 && npm install --no-audit --no-fund \
 && chmod -R a+rwX /opt/epg

ENV TZ=Europe/Rome \
    HOME=/tmp \
    EPG_DIR=/opt/epg \
    EPG_REF=$EPG_REF \
    PLAYLIST=/data/public/iptvitaplus.m3u \
    OUTPUT=/data/public/guide.xml

WORKDIR /app
COPY generate-epg.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

# mount your repository clone here
VOLUME /data

ENTRYPOINT ["/app/entrypoint.sh"]
