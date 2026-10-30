// Web app build: files are served next to the page, saved stops live in localStorage, and
// feeds go through the Worker proxy in worker/index.js.
const MTA_FEED_PREFIX = '/Dataservice/mtagtfsfeeds/';

export function assetUrl(path) {
  return path;
}

export function feedUrl(url) {
  if (url.startsWith('/api/')) return url;
  const parsed = new URL(url);
  if (parsed.hostname === 'api-endpoint.mta.info' && parsed.pathname.startsWith(MTA_FEED_PREFIX)) {
    return `/api/mta/${parsed.pathname.slice(MTA_FEED_PREFIX.length)}`;
  }
  if (parsed.hostname === 'www.panynj.gov') return '/api/path';
  throw new Error('This feed is not available in the web app.');
}

export function busFeedUrls() {
  return { alerts: '/api/bus/alerts' };
}

// Bus predictions for one stop and line; the citywide trip-updates feed is too big for phones.
export function busStopMonitoringUrl(stopId, lineRef) {
  return `/api/bus/stop-monitoring?${new URLSearchParams({ stop: stopId, line: lineRef })}`;
}

// localStorage can throw (private browsing, blocked storage); saved stops then last only
// until the page closes.
function read(key) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  } catch {
    return undefined;
  }
}

function write(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing else to fall back to.
  }
}

export const storage = {
  get: async (keys) => Object.fromEntries(keys.map((key) => [key, read(key)])),
  set: async (values) => Object.entries(values).forEach(([key, value]) => write(key, value)),
  remove: async (key) => write(key, undefined)
};
