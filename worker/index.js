// Proxy for the web app: browsers can't call the MTA and PATH feeds directly (CORS), and the
// bus API key must stay server side. Only the feeds listed in the repo's feed files are served.
import subwayFeedList from '../gtfs_subway/realtime_feed_apis.txt';
import alertFeedList from '../gtfs_subway/service_alert_feeds.txt';
import busFeedList from '../gtfs_subway/mta_bus_realtime_feed_apis.txt';
import { PATH_FEED_URL } from '../src/path.js';

const MTA_FEED_PREFIX = '/Dataservice/mtagtfsfeeds/';
// Per-stop bus predictions (SIRI). The citywide GTFS trip-updates feed is several MB, too
// heavy to download on a phone every refresh.
const BUS_STOP_MONITORING_URL = 'https://bustime.mta.info/api/siri/stop-monitoring.json';
const MEMORY_CACHE_LIMIT = 500;
const CACHE_SECONDS = 20;
const UPSTREAM_TIMEOUT_MS = 10_000;

function feedUrls(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

// "/api/mta/nyct%2Fgtfs-ace" -> the MTA URL, keyed by the encoded path after the feed prefix.
const mtaFeeds = new Map([...feedUrls(subwayFeedList), ...feedUrls(alertFeedList)]
  .map((value) => new URL(value))
  .filter((url) => url.hostname === 'api-endpoint.mta.info' && url.pathname.startsWith(MTA_FEED_PREFIX))
  .map((url) => [url.pathname.slice(MTA_FEED_PREFIX.length), url.href]));

// Only bus alerts come from GTFS; predictions use the per-stop route above.
const busFeeds = new Map(feedUrls(busFeedList)
  .map((value) => new URL(value))
  .filter((url) => url.hostname === 'gtfsrt.prod.obanyc.com' && url.pathname === '/alerts')
  .map((url) => [url.pathname.split('/').pop(), url]));

function upstreamUrl(pathname, searchParams, env) {
  if (pathname === '/api/path') return PATH_FEED_URL;
  if (pathname === '/api/bus/stop-monitoring') {
    const stop = searchParams.get('stop') || '';
    const line = searchParams.get('line') || '';
    if (!/^\d{1,10}$/.test(stop) || !/^[A-Za-z ]{2,20}_[A-Za-z0-9+-]{1,12}$/.test(line) || !env.MTA_BUS_API_KEY) return null;
    const url = new URL(BUS_STOP_MONITORING_URL);
    url.searchParams.set('key', env.MTA_BUS_API_KEY);
    url.searchParams.set('version', '2');
    url.searchParams.set('MonitoringRef', stop);
    url.searchParams.set('LineRef', line);
    return url.href;
  }
  if (pathname.startsWith('/api/mta/')) return mtaFeeds.get(pathname.slice('/api/mta/'.length)) || null;
  if (pathname.startsWith('/api/bus/')) {
    const feed = busFeeds.get(pathname.slice('/api/bus/'.length));
    if (!feed || !env.MTA_BUS_API_KEY) return null;
    const url = new URL(feed);
    url.searchParams.set('key', env.MTA_BUS_API_KEY);
    return url.href;
  }
  return null;
}

// The Cache API is a no-op on *.workers.dev, so each isolate also keeps recent feeds in
// memory and shares one in-flight upstream request between concurrent users.
const memoryCache = new Map();

async function fetchUpstream(url) {
  const now = Date.now();
  const cached = memoryCache.get(url);
  if (cached && now - cached.fetchedAt < CACHE_SECONDS * 1000) return cached.request;
  if (memoryCache.size >= MEMORY_CACHE_LIMIT) {
    for (const [key, entry] of memoryCache) {
      if (now - entry.fetchedAt >= CACHE_SECONDS * 1000) memoryCache.delete(key);
    }
  }

  const request = (async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'NYC Transit Tracker (+https://github.com/Al-Ashir-Intisar/NYCSubwayTracker)' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
    return {
      body: await response.arrayBuffer(),
      contentType: response.headers.get('content-type') || 'application/octet-stream'
    };
  })();
  memoryCache.set(url, { fetchedAt: now, request });
  request.catch(() => memoryCache.delete(url));
  return request;
}

async function handleApi(request, env, ctx) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const upstream = upstreamUrl(url.pathname, url.searchParams, env);
  if (!upstream) return new Response('Unknown feed', { status: 404 });

  const cacheKey = new Request(`${url.origin}${url.pathname}${url.search}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let feed;
  try {
    feed = await fetchUpstream(upstream);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return new Response(timedOut ? 'Upstream timed out' : 'Upstream unavailable', { status: timedOut ? 504 : 502 });
  }

  const response = new Response(feed.body, {
    headers: {
      'Content-Type': feed.contentType,
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`
    }
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  }
};
