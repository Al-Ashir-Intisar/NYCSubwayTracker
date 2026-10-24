import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const envText = readFileSync(resolve(root, '.dev.vars'), 'utf8');
const apiKey = envText.match(/^MTA_BUS_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  throw new Error('Set MTA_BUS_API_KEY in the ignored .dev.vars file before building.');
}

const endpoints = readFileSync(resolve(root, 'gtfs_subway/mta_bus_realtime_feed_apis.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const feeds = {};
for (const endpoint of endpoints) {
  let url;
  try {
    url = new URL(endpoint.replaceAll('<YOUR_KEY>', encodeURIComponent(apiKey)));
  } catch {
    throw new Error('An MTA bus feed URL is invalid.');
  }
  const feedName = url.pathname.split('/').pop();
  if (url.protocol !== 'https:' || url.hostname !== 'gtfsrt.prod.obanyc.com'
    || !['tripUpdates', 'alerts'].includes(feedName)) {
    throw new Error('The MTA bus feed list contains an unsupported endpoint.');
  }
  url.searchParams.set('key', apiKey);
  feeds[feedName] = url.href;
}
for (const requiredFeed of ['tripUpdates', 'alerts']) {
  if (!feeds[requiredFeed]) {
    throw new Error(`The MTA bus feed list is missing ${requiredFeed}.`);
  }
}

const outputDirectory = resolve(root, 'dist');
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  resolve(outputDirectory, 'bus-config.js'),
  `globalThis.NYC_BUS_FEED_URLS = ${JSON.stringify(feeds)};\n`
);

await build({
  entryPoints: [resolve(root, 'src/popup.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  outfile: resolve(outputDirectory, 'popup.js')
});
