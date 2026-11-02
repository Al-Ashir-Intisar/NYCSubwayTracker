// Zips the built extension for the Chrome Web Store: only the files the extension loads, with
// manifest.json at the root of the zip. Run through `npm run package:extension`, which builds
// first. The output (dist/nyc-transit-tracker-<version>.zip) contains the bus API key from the
// build, so upload it only to the store.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const EXTENSION_FILES = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'dist/popup.js',
  'dist/bus-config.js',
  'gtfs_subway/stops.txt',
  'gtfs_subway/routes.txt',
  'gtfs_subway/realtime_feed_apis.txt',
  'gtfs_subway/service_alert_feeds.txt',
  'gtfs_bus/stops.txt',
  'gtfs_bus/routes.txt'
];

const missing = EXTENSION_FILES.filter((file) => !existsSync(resolve(root, file)));
if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Run npm run build:extension first.`);

const { version } = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const output = resolve(root, `dist/nyc-transit-tracker-${version}.zip`);
rmSync(output, { force: true });
// -X leaves out macOS extended attributes, so the zip has no __MACOSX entries.
execFileSync('zip', ['-X', '-q', output, ...EXTENSION_FILES], { cwd: root, stdio: 'inherit' });
console.log(`Created ${output} (${Math.round(statSync(output).size / 1024)} KB)`);
