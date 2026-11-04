// PATH has no official realtime API. This reads the JSON that powers the schedule page on
// panynj.gov. It is unofficial and can change or go away without notice, so callers must
// treat every failure as expected.
export const PATH_FEED_URL = 'https://www.panynj.gov/bin/portauthority/ridepath.json';
// The PATH alerts page reads this (Everbridge messages from the last 8 hours). Alerts are free
// text with no station or line tags, so they are shown for the whole system.
export const PATH_ALERTS_URL = 'https://www.panynj.gov/bin/portauthority/alerts?agency=PATH&hours=8';

const PATH_COLOR = '0F5FA8';
const PATH_STATIONS = [
  ['09S', '9th Street'],
  ['14S', '14th Street'],
  ['23S', '23rd Street'],
  ['33S', '33rd Street'],
  ['CHR', 'Christopher Street'],
  ['EXP', 'Exchange Place'],
  ['GRV', 'Grove Street'],
  ['HAR', 'Harrison'],
  ['HOB', 'Hoboken'],
  ['JSQ', 'Journal Square'],
  ['NWK', 'Newark'],
  ['NEW', 'Newport'],
  ['WTC', 'World Trade Center']
];
// PATH has colored lines that share stations, so a saved stop picks a direction, not a route.
const PATH_DIRECTIONS = [
  { route_id: 'ToNY', route_short_name: 'NY', route_long_name: 'To New York' },
  { route_id: 'ToNJ', route_short_name: 'NJ', route_long_name: 'To New Jersey' },
  { route_id: 'Both', route_short_name: '↔', route_long_name: 'Both directions' }
];
const DIRECTION_MARKERS = { ToNY: 'NY', ToNJ: 'NJ' };

export function buildPathData() {
  const stations = PATH_STATIONS
    .map(([stopId, stopName]) => ({ stop_id: stopId, stop_name: stopName }))
    .sort((left, right) => left.stop_name.localeCompare(right.stop_name, 'en', { numeric: true }));
  return {
    stations,
    stationById: new Map(stations.map((station) => [station.stop_id, station])),
    stopsByStation: new Map(),
    stationByStopId: new Map(),
    routesById: new Map(PATH_DIRECTIONS.map((direction) => [direction.route_id, {
      ...direction,
      route_color: PATH_COLOR,
      route_text_color: 'FFFFFF'
    }])),
    stationLabels: new Map(stations.map((station) => [station.stop_id, station.stop_name]))
  };
}

// Arrival times are the time the feed was fetched plus the reported countdown; the feed's own
// lastUpdated timestamps come from a different clock and can run ahead of the user's.
export function findPathArrivals(feed, favorite, fetchedAt = Date.now()) {
  const station = (feed?.results || []).find((result) => result.consideredStation === favorite.stationId);
  const arrivals = [];

  for (const destination of station?.destinations || []) {
    if (favorite.routeId !== 'Both' && destination.label !== favorite.routeId) continue;
    for (const message of destination.messages || []) {
      const seconds = Number(message.secondsToArrival);
      if (!Number.isFinite(seconds) || seconds < 0) continue;
      arrivals.push({
        epoch: fetchedAt / 1000 + seconds,
        direction: DIRECTION_MARKERS[destination.label] || '',
        destination: message.headSign || 'Destination unavailable',
        color: /^[a-f\d]{6}$/i.test(message.lineColor || '') ? message.lineColor : ''
      });
    }
  }
  return arrivals.sort((left, right) => left.epoch - right.epoch);
}

// Each incident is a thread of messages sharing an ebid; keep only the latest message of each,
// and drop incidents whose latest message is the "Final Update" (resolved). The feed's own
// state field says "Closed" even for ongoing outages, so it isn't used. Advisories are also
// re-sent as new incidents every hour or so, so alerts with the same title are merged too.
export function findPathAlerts(messages) {
  const latest = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const sentAt = Number(String(message?.sentdate2 || '').match(/\d+/)?.[0]);
    if (!message?.Subject || !Number.isFinite(sentAt)) continue;
    const id = String(message.ebid ?? message.messageid);
    if (!latest.has(id) || latest.get(id).sentAt < sentAt) latest.set(id, { ...message, sentAt });
  }
  return [...latest.entries()]
    .filter(([, message]) => !/final update/i.test(message.Subject))
    .map(([id, message]) => ({
      id,
      sentAt: message.sentAt,
      title: message.Subject.replace(/^PATHAlert\s*(Final\s+)?(Update)?\s*:\s*/i, '').trim() || 'PATH alert',
      message: String(message.SentMessage || '')
    }))
    .sort((left, right) => right.sentAt - left.sentAt)
    .filter((alert, index, alerts) => alerts.findIndex((other) => (
      other.title.toLowerCase() === alert.title.toLowerCase()
    )) === index);
}
