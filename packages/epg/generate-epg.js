// generate-epg.js: builds the XMLTV guide for the channels in the playlist.
//   1. reads the playlist (default: /data/public/iptvitaplus.m3u)
//   2. matches each channel to an Italian source of iptv-org/epg
//      (first by tvg-id, then by channel name)
//   3. writes a channels file that uses the playlist tvg-ids, so Jellyfin
//      matches the guide to the channels on its own
//   4. runs the iptv-org/epg grabber and writes the guide (default:
//      /data/public/guide.xml)
// Usage: node generate-epg.js [--match-only]
// Env: PLAYLIST, OUTPUT, EPG_DIR, DAYS, MAX_CONNECTIONS, SITES
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLAYLIST = process.env.PLAYLIST || '/data/public/iptvitaplus.m3u';
const OUTPUT = process.env.OUTPUT || '/data/public/guide.xml';
const EPG_DIR = process.env.EPG_DIR || '/opt/epg';
const DAYS = process.env.DAYS || '';
const MAX_CONNECTIONS = process.env.MAX_CONNECTIONS || '5';
// Italian sources, in order of preference
const SITES = (process.env.SITES
  || 'raiplay.it,mediasetinfinity.mediaset.it,superguidatv.it,guidatv.sky.it,guida.tv')
  .split(',').map((s) => s.trim()).filter(Boolean);

// lowercase, no accents, letters and digits only
function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// "Rai1.it@SD" -> "rai1.it"
function idKey(id) {
  return id.split('@')[0].toLowerCase();
}

// "Rai 1 HD" -> "rai1", "TGCOM 24" -> "tgcom24"
function nameKey(name) {
  return normalize(name).replace(/(hd|tv)$/, '') || normalize(name);
}

function unescapeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readPlaylist(file) {
  const channels = [];
  const seen = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('#EXTINF')) continue;
    const id = (line.match(/tvg-id="([^"]+)"/) || [])[1];
    const name = line.split(',').pop().trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    channels.push({ id, name });
  }
  return channels;
}

function readSourceChannels() {
  const entries = [];
  SITES.forEach((site, rank) => {
    const dir = path.join(EPG_DIR, 'sites', site);
    if (!fs.existsSync(dir)) {
      console.warn(`Warning: source ${site} not found in ${dir}, skipped`);
      return;
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.channels.xml'))) {
      const xml = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of xml.matchAll(/<channel\s+([^>]*)>([^<]*)<\/channel>/g)) {
        const attrs = Object.fromEntries(
          [...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], unescapeXml(a[2])]),
        );
        if (attrs.lang && attrs.lang !== 'it') continue;
        entries.push({
          site: attrs.site || site,
          siteId: attrs.site_id,
          lang: attrs.lang || 'it',
          xmltvId: attrs.xmltv_id || '',
          name: unescapeXml(m[2].trim()),
          rank,
        });
      }
    }
  });
  return entries;
}

// picks the best source entry for a playlist channel
function match(channel, entries) {
  const byRank = (a, b) => a.rank - b.rank
    || Number(!a.xmltvId) - Number(!b.xmltvId); // prefer entries with an id
  const id = channel.id.toLowerCase();
  const byId = entries.filter((e) => e.xmltvId && idKey(e.xmltvId) === id).sort(byRank);
  if (byId.length) return { entry: byId[0], how: 'id' };
  const key = nameKey(channel.name);
  const byName = entries.filter((e) => nameKey(e.name) === key).sort(byRank);
  if (byName.length) return { entry: byName[0], how: 'name' };
  return null;
}

function main() {
  const matchOnly = process.argv.includes('--match-only');
  if (!fs.existsSync(PLAYLIST)) {
    throw new Error(`playlist not found at ${PLAYLIST} (generate it first)`);
  }
  const channels = readPlaylist(PLAYLIST);
  const entries = readSourceChannels();
  if (!entries.length) throw new Error(`no source channels found in ${EPG_DIR}/sites`);

  const matched = [];
  const missing = [];
  for (const ch of channels) {
    const result = match(ch, entries);
    if (result) matched.push({ ...ch, ...result });
    else missing.push(ch);
  }

  console.log(`Matched ${matched.length} of ${channels.length} channels:`);
  for (const m of matched) {
    console.log(`  ${m.id.padEnd(22)} <- ${m.entry.site} "${m.entry.name}" (by ${m.how})`);
  }
  if (missing.length) {
    console.log(`No guide source for ${missing.length} channels:`);
    console.log(`  ${missing.map((c) => c.name).join(', ')}`);
  }
  if (matchOnly) return;

  // channels file for the grabber: xmltv_id = playlist tvg-id
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<channels>'];
  for (const m of matched) {
    lines.push(`  <channel site="${escapeXml(m.entry.site)}" site_id="${escapeXml(m.entry.siteId)}"`
      + ` lang="${m.entry.lang}" xmltv_id="${escapeXml(m.id)}">${escapeXml(m.name)}</channel>`);
  }
  lines.push('</channels>');
  const channelsFile = path.join(EPG_DIR, 'playlist.channels.xml');
  fs.writeFileSync(channelsFile, lines.join('\n') + '\n');

  // grab into a temporary file, then replace the guide only on success
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const tmp = `${OUTPUT}.tmp`;
  const args = ['run', 'grab', '--', `--channels=${channelsFile}`, `--output=${tmp}`,
    `--maxConnections=${MAX_CONNECTIONS}`];
  if (DAYS) args.push(`--days=${DAYS}`);
  console.log(`Grabbing the guide (this can take a few minutes)...`);
  const run = spawnSync('npm', args, { cwd: EPG_DIR, stdio: 'inherit' });
  if (run.status !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw new Error('the grabber failed');
  }
  const guide = fs.readFileSync(tmp, 'utf8');
  const programmes = (guide.match(/<programme /g) || []).length;
  if (!programmes) {
    fs.unlinkSync(tmp);
    throw new Error('the grabber returned no programmes');
  }
  fs.renameSync(tmp, OUTPUT);
  console.log(`Done: ${programmes} programmes for ${matched.length} channels written to ${OUTPUT}`);
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  console.error('The guide file was not changed.');
  process.exit(1);
}
