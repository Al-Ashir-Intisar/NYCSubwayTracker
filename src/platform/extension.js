// Chrome extension build: files come from the extension package, saved stops from
// chrome.storage, and subway and PATH feeds are fetched directly (the manifest's
// host_permissions allow it). Bus feeds need the API key, so they go through the web app's
// Worker (worker/index.js).
const WORKER_ORIGIN = 'https://nyc-transit-tracker.iamintisar45.workers.dev';

export function apiUrl(path) {
  return `${WORKER_ORIGIN}${path}`;
}

export function assetUrl(path) {
  return chrome.runtime.getURL(path);
}

export function feedUrl(url) {
  return url;
}

export const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
  remove: (key) => chrome.storage.local.remove(key)
};
