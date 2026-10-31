// src/update.js: refreshes the TV8, Cielo and Sky TG24 links with yt-dlp.
// Usage: node src/update.js [playlist.m3u]   (default: italia.m3u)
// If yt-dlp finds no new link, the channel keeps its old one and is
// retried on the next run: no channel is ever dropped from the playlist.
const fs = require('fs');
const { execFileSync } = require('child_process');

// channel tvg-id -> official live stream page
const SKY_CHANNELS = {
  'Tv8.it': 'https://tv8.it/streaming',
  'CieloTv.it': 'https://www.cielotv.it/streaming',
  'SkyTG24.it': 'https://tg24.sky.it/diretta',
};

// make sure yt-dlp is installed before touching the playlist
try {
  execFileSync('yt-dlp', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('Error: yt-dlp not found. Install it with "pip install yt-dlp".');
  process.exit(1);
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

const file = process.argv[2] || 'italia.m3u';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const output = [];
let block = [];
let updated = 0;
let failed = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  if (line.startsWith('#EXTM3U')) { output.push(line); continue; }
  block.push(line);
  if (line.startsWith('#')) continue;

  // the line without # is the link: the channel block is complete
  const id = (block[0].match(/tvg-id="([^"]+)"/) || [])[1];
  if (id && SKY_CHANNELS[id]) {
    const name = block[0].split(',').pop();
    const url = fetchNewLink(SKY_CHANNELS[id]);
    if (url) {
      block[block.length - 1] = url;
      updated++;
      console.log(`Updated: ${name}`);
    } else {
      failed++;
      console.log(`Not updated: ${name} (keeping the old link, will retry next run)`);
    }
  }
  output.push(...block);
  block = [];
}

fs.writeFileSync(file, output.join('\n') + '\n');
console.log(`Done: ${updated} updated, ${failed} not updated in ${file}`);