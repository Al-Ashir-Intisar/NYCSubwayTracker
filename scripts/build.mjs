// Builds the Chrome extension (dist/popup.js, loaded from the repo root) and the web app
// (dist/web/, served by the Worker in worker/index.js). Pass "extension" or "web" to build one.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const targets = process.argv.slice(2);
const buildAll = !targets.length;

async function buildExtension() {
  const outputDirectory = resolve(root, 'dist');
  mkdirSync(outputDirectory, { recursive: true });
  // Older builds wrote the bus API key here; the extension now gets bus data from the Worker.
  rmSync(resolve(outputDirectory, 'bus-config.js'), { force: true });

  await build({
    entryPoints: [resolve(root, 'src/popup.js')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    alias: { platform: resolve(root, 'src/platform/extension.js') },
    outfile: resolve(outputDirectory, 'popup.js')
  });
}

const WEB_DATA_FILES = [
  'gtfs_subway/stops.txt',
  'gtfs_subway/routes.txt',
  'gtfs_subway/realtime_feed_apis.txt',
  'gtfs_subway/service_alert_feeds.txt',
  'gtfs_bus/stops.txt',
  'gtfs_bus/routes.txt'
];

const WEB_HEAD = `
    <meta name="theme-color" content="#1b2524">
    <meta name="description" content="Realtime NYC subway, bus and PATH arrivals for the stops you track.">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="NYC Transit">
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="icon" href="icons/icon-192.png" type="image/png">
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
    <link rel="stylesheet" href="popup.css">
    <link rel="stylesheet" href="web.css">`;

const WEB_SCRIPTS = `<script src="app.js"></script>
    <script>
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
    </script>`;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

async function buildWeb() {
  const outputDirectory = resolve(root, 'dist/web');
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  await build({
    entryPoints: [resolve(root, 'src/popup.js')],
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome110', 'safari16', 'firefox110'],
    alias: { platform: resolve(root, 'src/platform/web.js') },
    outfile: resolve(outputDirectory, 'app.js')
  });

  for (const file of WEB_DATA_FILES) {
    mkdirSync(dirname(resolve(outputDirectory, file)), { recursive: true });
    cpSync(resolve(root, file), resolve(outputDirectory, file));
  }
  cpSync(resolve(root, 'popup.css'), resolve(outputDirectory, 'popup.css'));
  cpSync(resolve(root, 'web/web.css'), resolve(outputDirectory, 'web.css'));
  cpSync(resolve(root, 'web/manifest.webmanifest'), resolve(outputDirectory, 'manifest.webmanifest'));
  cpSync(resolve(root, 'web/icons'), resolve(outputDirectory, 'icons'), { recursive: true });

  const popupHtml = readFileSync(resolve(root, 'popup.html'), 'utf8');
  const indexHtml = popupHtml
    .replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"')
    .replace(/\s*<link rel="stylesheet" href="popup.css">/, WEB_HEAD)
    .replace('<script src="dist/popup.js"></script>', WEB_SCRIPTS);
  if (indexHtml.includes('dist/popup.js') || !indexHtml.includes('manifest.webmanifest')) {
    throw new Error('popup.html no longer matches what the web build expects.');
  }
  writeFileSync(resolve(outputDirectory, 'index.html'), indexHtml);

  // The service worker precaches every file of this build; a new hash makes browsers pick
  // up the new version on the next visit.
  const files = listFiles(outputDirectory).map((path) => relative(outputDirectory, path)).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(readFileSync(resolve(outputDirectory, file)));
  const serviceWorker = readFileSync(resolve(root, 'web/sw.js'), 'utf8')
    .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 12))
    .replace('__PRECACHE_FILES__', JSON.stringify(['./', ...files.filter((file) => file !== 'index.html')]));
  writeFileSync(resolve(outputDirectory, 'sw.js'), serviceWorker);
}

if (buildAll || targets.includes('extension')) await buildExtension();
if (buildAll || targets.includes('web')) await buildWeb();
