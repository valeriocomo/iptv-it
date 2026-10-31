// generate.js: builds the Italian IPTV playlist to publish on GitHub.
//   1. downloads the upstream playlist (Tundrak/IPTV-Italia)
//   2. refreshes the TV8, Cielo and Sky TG24 links with yt-dlp
//   3. writes the result to the output folder, keeping the upstream file name
// Usage: node generate.js [output-folder]   (default: public)
// SOURCE_URL overrides the upstream playlist.
// Needs Node.js 18+ (built-in fetch) and yt-dlp; run it from an Italian IP.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_URL = process.env.SOURCE_URL
  || 'https://raw.githubusercontent.com/Tundrak/IPTV-Italia/main/iptvitaplus.m3u';

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
      channels.push({ id, name: block[0].split(',').pop(), lines: block });
      block = [];
    }
  }
  return { header, channels };
}

function fetchNewLink(page) {
  // first ask for a single audio+video stream, then for any format
  for (const args of [['-g', '-f', 'b', page], ['-g', page]]) {
    try {
      const output = execFileSync('yt-dlp', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 60000,
      });
      const url = output.split(/\r?\n/).find((l) => l.startsWith('http'));
      if (url) return url;
    } catch {
      // yt-dlp failed: try the next attempt
    }
  }
  return null;
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
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const source = await response.text();
  if (!source.trimStart().startsWith('#EXTM3U')) {
    throw new Error('the downloaded file is not an M3U playlist');
  }
  const { header, channels } = parse(source);

  // links from the previous run: used when yt-dlp finds no new one,
  // so a working token is not replaced by the expired upstream one
  const previous = {};
  if (fs.existsSync(file)) {
    for (const ch of parse(fs.readFileSync(file, 'utf8')).channels) {
      if (SKY_CHANNELS[ch.id]) previous[ch.id] = ch.lines[ch.lines.length - 1];
    }
  }

  let updated = 0;
  let failed = 0;
  for (const ch of channels) {
    if (!SKY_CHANNELS[ch.id]) continue;
    const last = ch.lines.length - 1;
    const url = fetchNewLink(SKY_CHANNELS[ch.id]);
    if (url) {
      ch.lines[last] = url;
      updated++;
      console.log(`Updated: ${ch.name}`);
    } else {
      failed++;
      if (previous[ch.id]) ch.lines[last] = previous[ch.id];
      const kept = previous[ch.id] ? 'previous run' : 'upstream playlist';
      console.log(`Not updated: ${ch.name} (keeping the link from the ${kept})`);
    }
  }

  const lines = [...(header.length ? header : ['#EXTM3U'])];
  for (const ch of channels) lines.push(...ch.lines);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`Done: ${channels.length} channels written to ${file} `
    + `(Sky: ${updated} updated, ${failed} not updated)`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  console.error('The output file was not changed.');
  process.exit(1);
});