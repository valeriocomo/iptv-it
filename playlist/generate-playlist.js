// playlist/generate-playlist.js: builds the Italian IPTV playlist to publish on GitHub.
//   1. downloads the upstream playlist (Tundrak/IPTV-Italia)
//   2. refreshes the TV8, Cielo and Sky TG24 links with yt-dlp
//   3. checks every link with the User-Agent Jellyfin uses; a link that does
//      not answer is replaced with a working official one: the fixed RAI
//      relinker link, or an iptv-org link that is not a third-party rebroadcast
//   4. writes the result to the output folder, keeping the upstream file name
// Usage: node playlist/generate-playlist.js [output-folder]   (default: public)
// Env: SOURCE_URL, ALT_SOURCE_URL, USER_AGENT, CHECK_STREAMS
// Needs Node.js 18+ (built-in fetch) and yt-dlp; run it from an Italian IP.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_URL = process.env.SOURCE_URL
  || 'https://raw.githubusercontent.com/Tundrak/IPTV-Italia/main/iptvitaplus.m3u';
// alternative links, maintained and checked daily by iptv-org
const ALT_SOURCE_URL = process.env.ALT_SOURCE_URL
  || 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/it.m3u';
// must match the User agent set on the Jellyfin M3U tuner
const USER_AGENT = process.env.USER_AGENT || 'HbbTV/1.6.1';
const CHECK_STREAMS = process.env.CHECK_STREAMS !== '0';
// 1 = leave out of the playlist the channels whose link does not work
const REMOVE_NOT_WORKING = process.env.REMOVE_NOT_WORKING === '1';
const CHECK_TIMEOUT = 10000;
const CHECK_PARALLEL = 8;

// output file name = upstream file name (e.g. iptvitaplus.m3u)
const FILE_NAME = path.posix.basename(new URL(SOURCE_URL).pathname) || 'playlist.m3u';

// channel tvg-id -> official live stream page
const SKY_CHANNELS = {
  'Tv8.it': 'https://tv8.it/streaming',
  'CieloTv.it': 'https://www.cielotv.it/streaming',
  'SkyTG24.it': 'https://tg24.sky.it/diretta',
};

// splits a playlist into its header and channel blocks
// (each block = #EXTINF line, optional # options, link as last line)
function parse(text) {
  const header = [];
  const channels = [];
  let block = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('#EXTM3U')) { header.push(line); continue; }
    block.push(line);
    if (!line.startsWith('#')) {
      const id = (block[0].match(/tvg-id="([^"]+)"/) || [])[1];
      channels.push({ id, name: block[0].split(',').pop().trim(), lines: block });
      block = [];
    }
  }
  return { header, channels };
}

// "LA7.it@HD" -> "la7.it"
function idKey(id) {
  return (id || '').split('@')[0].toLowerCase();
}

// "LA7 HD (1080p) [Geo-blocked]" -> "la7"
function nameKey(name) {
  const plain = name.replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  return plain.replace(/hd$/, '') || plain;
}

// returns { url } on success, { error } with yt-dlp's reason on failure
function fetchNewLink(page) {
  let error = 'yt-dlp returned no link';
  // first ask for a single audio+video stream, then for any format
  for (const args of [['-g', '-f', 'b', page], ['-g', page]]) {
    try {
      const output = execFileSync('yt-dlp', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
      });
      const url = output.split(/\r?\n/).find((l) => l.startsWith('http'));
      if (url) return { url };
    } catch (err) {
      // keep yt-dlp's last ERROR line, then try the next attempt
      const lines = String(err.stderr || '').split(/\r?\n/);
      const reason = lines.filter((l) => l.startsWith('ERROR')).pop();
      if (reason) error = reason;
      else if (err.code === 'ETIMEDOUT') error = 'yt-dlp timed out after 60 s';
    }
  }
  return { error };
}

// opens a stream link as Jellyfin would: null if it works, else the reason
async function checkStream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return `HTTP ${res.status}`;
    // read only the beginning: enough to recognise an HLS or DASH manifest
    const reader = res.body.getReader();
    let head = '';
    while (head.length < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      head += Buffer.from(value).toString('utf8');
    }
    reader.cancel().catch(() => {});
    return /#EXTM3U|<MPD/i.test(head) ? null : 'not an HLS or DASH stream';
  } catch (err) {
    if (err.name === 'AbortError') return 'timeout';
    return (err.cause && (err.cause.code || err.cause.message)) || err.message;
  } finally {
    clearTimeout(timer);
  }
}

// runs fn on every item, at most `limit` at a time
async function eachLimited(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download of ${url} failed: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trimStart().startsWith('#EXTM3U')) {
    throw new Error(`${url} is not an M3U playlist`);
  }
  return text;
}

// alternative link blocks for a channel, matched by tvg-id, then by name
function alternativesFor(ch, alternatives) {
  const byId = alternatives.filter((a) => a.id && idKey(a.id) === idKey(ch.id));
  if (byId.length) return byId;
  return alternatives.filter((a) => nameKey(a.name) === nameKey(ch.name));
}

function linkOf(block) {
  return block.lines[block.lines.length - 1];
}

function groupOf(ch) {
  return (ch.lines[0].match(/group-title="([^"]*)"/) || [])[1] || '';
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

// The RAI relinker answers 503 to the old parameters used upstream
// (output=7&forceUserAgent=...): the same official link with cont= alone works.
function raiRelinkerFix(url) {
  try {
    const u = new URL(url);
    if (!/^mediapolis(event)?\.rai\.it$/.test(u.hostname)) return null;
    const cont = u.searchParams.get('cont');
    const fixed = `https://${u.hostname}/relinker/relinkerServlet.htm?cont=${cont}`;
    return cont && fixed !== url ? fixed : null;
  } catch {
    return null;
  }
}

// Hosts whose iptv-org links are third-party rebroadcasts, not official streams:
//  - bare IP addresses or non-standard ports
//  - servers that carry channels of different broadcasters (e.g. La7 and RAI):
//    an official server only carries its own broadcaster's channels
function unofficialHosts(channels, alternatives) {
  const groups = new Map();
  for (const ch of channels) {
    for (const alt of alternativesFor(ch, alternatives)) {
      const host = hostOf(linkOf(alt));
      if (!groups.has(host)) groups.set(host, new Set());
      groups.get(host).add(groupOf(ch));
    }
  }
  const bad = new Set();
  for (const alt of alternatives) {
    const host = hostOf(linkOf(alt));
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!host || /:\d+$/.test(host) || /^[\d.]+$/.test(hostname) || hostname.includes(':')) {
      bad.add(host);
    }
  }
  for (const [host, set] of groups) if (set.size > 1) bad.add(host);
  return bad;
}

async function main() {
  const folder = process.argv[2] || 'public';
  const file = path.join(folder, FILE_NAME);

  // yt-dlp must be installed before anything is touched
  try {
    execFileSync('yt-dlp', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('yt-dlp not found. Install it with "pip install yt-dlp".');
  }

  console.log(`Downloading ${SOURCE_URL}`);
  const { header, channels } = parse(await download(SOURCE_URL));

  let alternatives = [];
  if (CHECK_STREAMS) {
    try {
      console.log(`Downloading ${ALT_SOURCE_URL}`);
      alternatives = parse(await download(ALT_SOURCE_URL)).channels;
    } catch (err) {
      console.log(`Warning: ${err.message}; dead links will not be replaced`);
    }
  }

  // links from the previous run: used when yt-dlp finds no new one,
  // so a working token is not replaced by the expired upstream one.
  // Only links on Sky's own servers are reused: a previous run may have
  // written a different link for the channel.
  const previous = {};
  if (fs.existsSync(file)) {
    for (const ch of parse(fs.readFileSync(file, 'utf8')).channels) {
      const link = linkOf(ch);
      if (SKY_CHANNELS[ch.id] && /(^|[.-])sky/.test(hostOf(link))) previous[ch.id] = link;
    }
  }

  let updated = 0;
  let failed = 0;
  for (const ch of channels) {
    if (!SKY_CHANNELS[ch.id]) continue;
    const last = ch.lines.length - 1;
    const result = fetchNewLink(SKY_CHANNELS[ch.id]);
    if (result.url) {
      ch.lines[last] = result.url;
      updated++;
      console.log(`Updated: ${ch.name}`);
    } else {
      failed++;
      if (previous[ch.id]) ch.lines[last] = previous[ch.id];
      const kept = previous[ch.id] ? 'previous run' : 'upstream playlist';
      console.log(`Not updated: ${ch.name} (keeping the link from the ${kept})`);
      console.log(`  reason: ${result.error}`);
    }
  }

  let ok = 0;
  let replaced = 0;
  const dead = [];
  const deadChannels = new Set();
  if (CHECK_STREAMS) {
    const unofficial = unofficialHosts(channels, alternatives);
    console.log(`Checking ${channels.length} links with User-Agent "${USER_AGENT}"...`);
    await eachLimited(channels, CHECK_PARALLEL, async (ch) => {
      const error = await checkStream(linkOf(ch));
      if (!error) { ok++; return; }

      // candidates, in order: the fixed RAI link, then official iptv-org links
      const candidates = [];
      const fixed = raiRelinkerFix(linkOf(ch));
      if (fixed) candidates.push({ lines: [ch.lines[0], fixed], source: 'RAI relinker' });
      let ignored = 0;
      for (const alt of alternativesFor(ch, alternatives)) {
        if (unofficial.has(hostOf(linkOf(alt)))) { ignored++; continue; }
        // keep our #EXTINF line (tvg-id, logo, number), take the new link
        candidates.push({ lines: [ch.lines[0], ...alt.lines.slice(1)], source: 'iptv-org' });
      }

      for (const c of candidates) {
        if (await checkStream(linkOf(c))) continue;
        ch.lines = c.lines;
        replaced++;
        console.log(`Replaced: ${ch.name} (${error}) -> ${linkOf(c)} [${c.source}]`);
        return;
      }
      const note = ignored ? `; ${ignored} unofficial alternative(s) ignored` : '';
      dead.push(`${ch.name} (${error}${note})`);
      deadChannels.add(ch);
    });
    if (dead.length) {
      const what = REMOVE_NOT_WORKING ? 'removed from the playlist' : 'kept in the playlist';
      console.log(`Not working, no official alternative found, ${what} (${dead.length}):`);
      for (const d of dead) console.log(`  ${d}`);
    }
  }

  const lines = [...(header.length ? header : ['#EXTM3U'])];
  for (const ch of channels) {
    if (REMOVE_NOT_WORKING && deadChannels.has(ch)) continue;
    lines.push(...ch.lines);
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const written = REMOVE_NOT_WORKING ? channels.length - deadChannels.size : channels.length;
  console.log(`Done: ${written} channels written to ${file}`);
  console.log(`  Sky: ${updated} updated, ${failed} not updated`);
  if (CHECK_STREAMS) {
    console.log(`  Links: ${ok} working, ${replaced} replaced, ${dead.length} not working`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  console.error('The output file was not changed.');
  process.exit(1);
});