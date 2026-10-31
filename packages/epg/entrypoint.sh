#!/bin/sh
# Runs once: updates the iptv-org/epg site parsers, then builds the guide.

cd "$EPG_DIR" || exit 1

echo "Updating iptv-org/epg..."
old_lock=$(md5sum package-lock.json)
if git fetch -q --depth 1 origin "$EPG_REF" && git reset -q --hard FETCH_HEAD; then
  # reinstall dependencies only when they changed upstream
  if [ "$old_lock" != "$(md5sum package-lock.json)" ]; then
    echo "Dependencies changed, reinstalling..."
    npm install --no-audit --no-fund --loglevel=error
  fi
else
  echo "iptv-org/epg update failed, using the installed version"
fi

exec node /app/generate-epg.js "$@"
