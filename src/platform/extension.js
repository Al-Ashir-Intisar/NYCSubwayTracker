// Chrome extension build: files come from the extension package, saved stops from
// chrome.storage, and feeds are fetched directly (the manifest's host_permissions allow it).
export function assetUrl(path) {
  return chrome.runtime.getURL(path);
}

export function feedUrl(url) {
  return url;
}

export function busFeedUrls() {
  return globalThis.NYC_BUS_FEED_URLS || {};
}

// The extension reads bus predictions from the citywide GTFS trip-updates feed instead.
export const busStopMonitoringUrl = null;

export const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
  remove: (key) => chrome.storage.local.remove(key)
};
