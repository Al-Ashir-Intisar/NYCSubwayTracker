import * as GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const SUBWAY_FAVORITES_KEY = 'trackedSubwayStops';
const BUS_FAVORITES_KEY = 'trackedBusStops';
const LEGACY_FAVORITES_KEY = 'trackedStops';
const FEEDS_PATH = 'gtfs_subway/realtime_feed_apis.txt';
const SERVICE_ALERT_FEEDS_PATH = 'gtfs_subway/service_alert_feeds.txt';
const STOPS_PATH = 'gtfs_subway/stops.txt';
const ROUTES_PATH = 'gtfs_subway/routes.txt';
const BUS_STOPS_PATH = 'gtfs_bus/stops.txt';
const BUS_ROUTES_PATH = 'gtfs_bus/routes.txt';
const REFRESH_INTERVAL_MS = 15_000;
const FEED_REQUEST_TIMEOUT_MS = 12_000;
const ROUTE_FEED_GROUP = {
  A: 'ACE', C: 'ACE', E: 'ACE',
  B: 'BDFM', D: 'BDFM', F: 'BDFM', FX: 'BDFM', M: 'BDFM',
  G: 'G', J: 'JZ', Z: 'JZ', L: 'L',
  N: 'NQRW', Q: 'NQRW', R: 'NQRW', W: 'NQRW',
  1: '1234567', 2: '1234567', 3: '1234567', 4: '1234567',
  5: '1234567', 6: '1234567', '6X': '1234567', 7: '1234567', '7X': '1234567',
  SI: 'SI', SIR: 'SI'
};

const subwayTab = document.querySelector('#subway-tab');
const busTab = document.querySelector('#bus-tab');
const views = {
  subway: {
    mode: 'subway',
    panel: document.querySelector('#subway-panel'),
    stationInput: document.querySelector('#subway-station-input'),
    stationOptions: document.querySelector('#subway-station-options'),
    routeInput: document.querySelector('#subway-route-input'),
    routeOptions: document.querySelector('#subway-route-options'),
    addButton: document.querySelector('#subway-add-button'),
    refreshButton: document.querySelector('#subway-refresh-button'),
    loadStatus: document.querySelector('#subway-load-status'),
    favoritesContainer: document.querySelector('#subway-favorites'),
    emptyState: document.querySelector('#subway-empty-state'),
    data: null
  },
  bus: {
    mode: 'bus',
    panel: document.querySelector('#bus-panel'),
    stationInput: document.querySelector('#bus-station-input'),
    stationOptions: document.querySelector('#bus-station-options'),
    routeInput: document.querySelector('#bus-route-input'),
    routeOptions: document.querySelector('#bus-route-options'),
    addButton: document.querySelector('#bus-add-button'),
    refreshButton: document.querySelector('#bus-refresh-button'),
    loadStatus: document.querySelector('#bus-load-status'),
    favoritesContainer: document.querySelector('#bus-favorites'),
    emptyState: document.querySelector('#bus-empty-state'),
    data: null
  }
};

let feedUrlsByGroup = new Map();
let busFeedUrls = {};
let serviceAlertFeedUrls = [];
const favoritesByMode = { subway: [], bus: [] };
const loadingModes = new Set();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ''])
  ));
}

async function loadText(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`Unable to read ${path} (HTTP ${response.status}).`);
  return response.text();
}

async function fetchFeedResponse(url, feedName) {
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FEED_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`${feedName} request timed out.`);
    }
    throw error;
  }
  if (!response.ok) throw new Error(`${feedName} returned HTTP ${response.status}.`);
  return response;
}

async function loadSubwayData() {
  const [stopsText, routesText, feedsText, serviceAlertFeedsText] = await Promise.all([
    loadText(STOPS_PATH),
    loadText(ROUTES_PATH),
    loadText(FEEDS_PATH),
    loadText(SERVICE_ALERT_FEEDS_PATH)
  ]);
  const data = buildSubwayData(stopsText, routesText);

  feedUrlsByGroup = new Map(feedsText.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        const url = new URL(value);
        if (url.hostname !== 'api-endpoint.mta.info') return null;
        const match = url.pathname.match(/gtfs-([^/]+)$/i);
        if (match) return [match[1].toUpperCase(), url.href];
        return /gtfs$/i.test(url.pathname) ? ['1234567', url.href] : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean));
  serviceAlertFeedUrls = serviceAlertFeedsText.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((value) => {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error('The service alert feed URL is invalid.');
      }
      if (url.protocol !== 'https:' || url.hostname !== 'api-endpoint.mta.info') {
        throw new Error('The service alert feed must use the MTA API endpoint.');
      }
      return url.href;
    });
  if (!serviceAlertFeedUrls.length) {
    throw new Error('No service alert feed is configured.');
  }

  return data;
}

async function loadBusData() {
  const [stopsText, routesText] = await Promise.all([
    loadText(BUS_STOPS_PATH),
    loadText(BUS_ROUTES_PATH)
  ]);
  busFeedUrls = globalThis.NYC_BUS_FEED_URLS || {};
  if (!busFeedUrls.tripUpdates || !busFeedUrls.alerts) {
    throw new Error('Bus API key configuration is missing. Set MTA_BUS_API_KEY in .dev.vars and run npm run build.');
  }
  return buildBusData(stopsText, routesText);
}

function initializeView(mode) {
  const view = views[mode];
  const { data } = view;
  attachPicker(view.stationInput, view.stationOptions, data.stations,
    (station) => data.stationLabels.get(station.stop_id), (station) => station.stop_id);
  attachPicker(view.routeInput, view.routeOptions, [...data.routesById.values()],
    (route) => `${route.route_short_name} · ${route.route_long_name}`, (route) => route.route_id);
  view.addButton.disabled = false;
  view.loadStatus.textContent = `${data.stations.length.toLocaleString()} ${mode === 'bus' ? 'bus stops' : 'stations'} loaded.`;
}

function buildSubwayData(stopsText, routesText) {
  return buildTransitData(stopsText, routesText);
}

function buildBusData(stopsText, routesText) {
  return buildTransitData(stopsText, routesText);
}

function buildTransitData(stopsText, routesText) {
  const stops = parseCsv(stopsText);
  const routes = parseCsv(routesText);
  const rootStops = stops.filter((stop) => stop.location_type === '1' || !stop.parent_station);

  const stations = [...new Map(rootStops.map((stop) => [stop.stop_id, stop])).values()]
    .sort((left, right) => left.stop_name.localeCompare(right.stop_name));
  const stationById = new Map(stations.map((station) => [station.stop_id, station]));
  const stationNameCounts = new Map();
  for (const station of stations) {
    stationNameCounts.set(station.stop_name, (stationNameCounts.get(station.stop_name) || 0) + 1);
  }
  const stationLabels = new Map(stations.map((station) => [
    station.stop_id,
    stationNameCounts.get(station.stop_name) > 1
      ? `${station.stop_name} · ${station.stop_id}`
      : station.stop_name
  ]));
  const stopsByStation = new Map(stations.map((station) => [station.stop_id, new Set([station.stop_id])]));
  const stationByStopId = new Map();
  for (const stop of stops) {
    const stationId = stop.parent_station || stop.stop_id;
    const station = stationById.get(stationId);
    if (station) stationByStopId.set(stop.stop_id, station);
    if (stop.parent_station && stopsByStation.has(stop.parent_station)) {
      stopsByStation.get(stop.parent_station).add(stop.stop_id);
    }
  }

  const routesById = new Map(routes.map((route) => [route.route_id, route]));
  return { stations, stationById, stopsByStation, stationByStopId, routesById, stationLabels };
}

function attachPicker(input, list, items, labelFor, idFor) {
  let matches = [];
  let activeIndex = -1;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function choose(item) {
    input.value = labelFor(item);
    input.dataset.selectedId = idFor(item);
    close();
  }

  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    matches = items.filter((item) => labelFor(item).toLocaleLowerCase().includes(query)).slice(0, 12);
    list.replaceChildren();
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');

    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'picker-empty';
      empty.textContent = 'No matches';
      list.append(empty);
    } else {
      matches.forEach((item, index) => {
        const option = document.createElement('li');
        option.id = `${list.id}-option-${index}`;
        option.className = 'picker-option';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = labelFor(item);
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.addEventListener('click', () => choose(item));
        list.append(option);
      });
    }

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function setActive(index) {
    if (!matches.length) return;
    activeIndex = (index + matches.length) % matches.length;
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.setAttribute('aria-selected', String(active));
      if (active) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  input.addEventListener('focus', render);
  input.addEventListener('input', () => {
    delete input.dataset.selectedId;
    render();
  });
  input.addEventListener('blur', () => window.setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (list.hidden) render();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) render();
      setActive(activeIndex < 0 ? matches.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && !list.hidden && activeIndex >= 0) {
      event.preventDefault();
      choose(matches[activeIndex]);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  return (nextItems, nextLabelFor, nextIdFor) => {
    items = nextItems;
    labelFor = nextLabelFor;
    idFor = nextIdFor;
    input.value = '';
    delete input.dataset.selectedId;
    close();
  };
}

function routeColor(route) {
  return /^[a-f\d]{6}$/i.test(route?.route_color || '') ? `#${route.route_color}` : '#007a5e';
}

function routeTextColor(route) {
  return /^[a-f\d]{6}$/i.test(route?.route_text_color || '') ? `#${route.route_text_color}` : '#ffffff';
}

function canonicalRoute(routeId) {
  if (routeId === 'FX') return 'F';
  if (routeId === '6X') return '6';
  if (routeId === '7X') return '7';
  if (routeId === 'SIR') return 'SI';
  return routeId;
}

function addFavorite(mode) {
  const view = views[mode];
  const station = view.data.stationById.get(view.stationInput.dataset.selectedId);
  const route = view.data.routesById.get(view.routeInput.dataset.selectedId);
  if (!station || !route) {
    view.loadStatus.textContent = `Choose a ${mode === 'bus' ? 'bus stop and route' : 'station and route'} from the search results.`;
    return;
  }

  const id = `${station.stop_id}:${route.route_id}`;
  if (favoritesByMode[mode].some((favorite) => (
    favorite.stationId === station.stop_id
    && favorite.routeId === route.route_id
  ))) {
    view.loadStatus.textContent = `That ${mode === 'bus' ? 'stop' : 'station'} and route are already tracked.`;
    return;
  }

  favoritesByMode[mode] = [...favoritesByMode[mode], {
    id,
    stationId: station.stop_id,
    stationName: station.stop_name,
    routeId: route.route_id
  }];
  persistFavorites(mode);
  renderFavorites(mode);
  view.loadStatus.textContent = 'Stop added.';
  if (mode === 'subway') refreshSubway();
  else refreshBus();
}

function persistFavorites(mode) {
  const key = mode === 'bus' ? BUS_FAVORITES_KEY : SUBWAY_FAVORITES_KEY;
  chrome.storage.local.set({ [key]: favoritesByMode[mode] });
}

function removeFavorite(mode, id) {
  favoritesByMode[mode] = favoritesByMode[mode].filter((favorite) => favorite.id !== id);
  persistFavorites(mode);
  renderFavorites(mode);
}

function setArrivalStatus(container, message, isError = false) {
  const status = document.createElement('p');
  status.className = isError ? 'arrival-status arrival-error' : 'arrival-status';
  status.textContent = message;
  container.append(status);
}

function renderFavorites(mode) {
  const view = views[mode];
  const favorites = favoritesByMode[mode];
  view.favoritesContainer.replaceChildren();
  view.emptyState.hidden = favorites.length > 0;

  for (const favorite of favorites) {
    const route = view.data.routesById.get(favorite.routeId);
    const card = document.createElement('article');
    card.className = 'favorite';
    card.dataset.favoriteId = favorite.id;
    card.style.setProperty('--route-color', routeColor(route));
    card.style.setProperty('--route-text', routeTextColor(route));

    const header = document.createElement('div');
    header.className = 'favorite-header';
    const badge = document.createElement('span');
    badge.className = 'route-badge';
    badge.textContent = route?.route_short_name || favorite.routeId;
    const name = document.createElement('h3');
    name.className = 'station-name';
    name.textContent = favorite.stationName;
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-button';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove ${favorite.routeId} at ${favorite.stationName}`);
    removeButton.addEventListener('click', () => removeFavorite(mode, favorite.id));
    header.append(badge, name, removeButton);
    card.append(header);
    favoritesContainer.append(card);
  }
}

function getTranslatedText(translatedString) {
  const translations = translatedString?.translation || [];
  return translations.find((translation) => translation.language === 'en')?.text
    || translations.find((translation) => !translation.language?.endsWith('-html'))?.text
    || '';
}

function getEpochSeconds(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  return Number(value);
}

function getTripDestinationStopId(update) {
  const stopUpdates = update.stopTimeUpdate || [];
  if (!stopUpdates.length) return '';

  const terminal = stopUpdates.reduce((last, stopUpdate) => {
    return Number(stopUpdate.stopSequence || 0) >= Number(last.stopSequence || 0)
      ? stopUpdate
      : last;
  }, stopUpdates[0]);
  return terminal.stopId || '';
}

async function fetchFeed(group, feedCache) {
  if (feedCache.has(group)) return feedCache.get(group);
  const url = feedUrlsByGroup.get(group);
  if (!url) throw new Error(`No realtime feed is configured for this route (${group}).`);

  const request = (async () => {
    const response = await fetchFeedResponse(url, 'Subway predictions');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  })();
  feedCache.set(group, request);
  return request;
}

async function fetchServiceAlerts() {
  const feeds = await Promise.all(serviceAlertFeedUrls.map(async (url) => {
    const response = await fetchFeedResponse(url, 'Subway alerts');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  }));
  return [...new Map(feeds.flatMap((feed) => (feed.entity || [])
    .filter((entity) => entity.alert)
    .map((entity) => [entity.id, { ...entity.alert, id: entity.id }]))).values()];
}

async function fetchBusFeed(feedName, feedCache) {
  const cacheKey = `bus:${feedName}`;
  if (feedCache.has(cacheKey)) return feedCache.get(cacheKey);
  const url = busFeedUrls[feedName];
  if (!url) throw new Error(`No MTA bus feed is configured for ${feedName}.`);

  const request = (async () => {
    const response = await fetchFeedResponse(url, 'Bus data');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  })();
  feedCache.set(cacheKey, request);
  return request;
}

async function fetchBusAlerts(feedCache) {
  const feed = await fetchBusFeed('alerts', feedCache);
  return (feed.entity || []).filter((entity) => entity.alert).map((entity) => ({
    ...entity.alert,
    id: entity.id
  }));
}

function isAlertActive(alert, now) {
  const periods = alert.activePeriod || [];
  return !periods.length || periods.some((period) => {
    const startsInTime = period.start == null || getEpochSeconds(period.start) <= now;
    const hasNotEnded = period.end == null || getEpochSeconds(period.end) >= now;
    return startsInTime && hasNotEnded;
  });
}

function matchServiceAlerts(alerts, favorite, mode) {
  const data = views[mode].data;
  const stationStopIds = data?.stopsByStation.get(favorite.stationId) || new Set([favorite.stationId]);
  const selectedRouteId = canonicalRoute(favorite.routeId);
  const now = Date.now() / 1000;
  return alerts.filter((alert) => isAlertActive(alert, now)
    && (alert.informedEntity || []).some((selector) => (
      selector.routeId !== undefined
      && selector.stopId !== undefined
      && (selector.routeType == null || selector.routeType === (mode === 'bus' ? 3 : 0))
      && canonicalRoute(selector.routeId) === selectedRouteId
      && stationStopIds.has(selector.stopId)
    )));
}

function findSubwayServiceAlerts(alerts, favorite) {
  return matchServiceAlerts(alerts, favorite, 'subway');
}

function findBusServiceAlerts(alerts, favorite) {
  return matchServiceAlerts(alerts, favorite, 'bus');
}

function isDelayAlert(alert) {
  return alert.effect === GtfsRealtimeBindings.transit_realtime.Alert.Effect.SIGNIFICANT_DELAYS
    || /delay/i.test(getTranslatedText(alert.headerText));
}

function renderServiceAlerts(card, alerts) {
  const expandedAlertIds = new Set(
    [...card.querySelectorAll('.service-alert[open]')].map((item) => item.dataset.alertId)
  );
  card.querySelector('.service-alerts, .service-alert-error')?.remove();
  card.classList.toggle('has-alert', alerts.length > 0);
  if (!alerts.length) return;

  const container = document.createElement('div');
  container.className = 'service-alerts';
  for (const alert of alerts) {
    const details = document.createElement('details');
    details.className = 'service-alert';
    details.dataset.alertId = alert.id || '';
    details.open = expandedAlertIds.has(alert.id || '');

    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'service-alert-label';
    label.textContent = isDelayAlert(alert) ? 'Delays' : 'Service alert';
    const header = document.createElement('span');
    header.className = 'service-alert-header';
    header.textContent = getTranslatedText(alert.headerText) || 'Service change';
    summary.append(label, header);
    details.append(summary);

    const description = document.createElement('p');
    description.className = 'service-alert-description';
    description.textContent = getTranslatedText(alert.descriptionText) || 'No additional details provided.';
    details.append(description);
    container.append(details);
  }
  card.append(container);
}

function findTransitArrivals(feed, favorite, mode) {
  const data = views[mode].data;
  const stationStopIds = data?.stopsByStation.get(favorite.stationId) || new Set([favorite.stationId]);
  const selectedRouteId = canonicalRoute(favorite.routeId);
  const now = Date.now() / 1000;
  const arrivals = [];

  for (const entity of feed.entity || []) {
    const update = entity.tripUpdate;
    if (!update) continue;
    const tripRouteId = update.trip?.routeId;
    if (!tripRouteId || canonicalRoute(tripRouteId) !== selectedRouteId) continue;
    const terminalStopId = getTripDestinationStopId(update);
    const destination = data?.stationByStopId.get(terminalStopId)?.stop_name || 'Destination unavailable';

    for (const stopUpdate of update.stopTimeUpdate || []) {
      if (!stationStopIds.has(stopUpdate.stopId)) continue;
      if (stopUpdate.scheduleRelationship === 1) continue;
      const epoch = getEpochSeconds(stopUpdate.arrival?.time ?? stopUpdate.departure?.time);
      if (!Number.isFinite(epoch) || epoch < now - 30 || epoch > now + 2 * 60 * 60) continue;
      const direction = mode === 'subway'
        ? stopUpdate.stopId.endsWith('N') ? 'N' : stopUpdate.stopId.endsWith('S') ? 'S' : ''
        : '';
      arrivals.push({
        epoch,
        tripId: update.trip?.tripId || entity.id,
        stopId: stopUpdate.stopId,
        direction,
        destination
      });
    }
  }

  const uniqueArrivals = new Map();
  for (const arrival of arrivals) {
    uniqueArrivals.set(`${arrival.tripId}:${arrival.epoch}:${arrival.stopId}`, arrival);
  }
  return [...uniqueArrivals.values()].sort((left, right) => left.epoch - right.epoch);
}

function findSubwayArrivals(feed, favorite) {
  return findTransitArrivals(feed, favorite, 'subway');
}

function findBusArrivals(feed, favorite) {
  return findTransitArrivals(feed, favorite, 'bus');
}

function renderArrivalGroups(card, arrivals) {
  const groups = new Map();
  for (const arrival of arrivals) {
    const key = `${arrival.direction}:${arrival.destination}`;
    if (!groups.has(key)) groups.set(key, { direction: arrival.direction, destination: arrival.destination, arrivals: [] });
    const group = groups.get(key);
    if (group.arrivals.length < 3) group.arrivals.push(arrival);
  }

  for (const group of groups.values()) {
    const section = document.createElement('section');
    section.className = 'arrival-group';
    section.dataset.direction = group.direction;

    const heading = document.createElement('h4');
    heading.className = 'arrival-destination';
    const marker = document.createElement('span');
    marker.className = 'direction-marker';
    marker.textContent = group.direction || '?';
    marker.setAttribute('aria-label', group.direction ? `${group.direction} direction` : 'Direction unavailable');
    const destination = document.createElement('span');
    destination.textContent = `To ${group.destination}`;
    heading.append(marker, destination);
    section.append(heading);

    const list = document.createElement('ul');
    list.className = 'arrival-list';
    for (const arrival of group.arrivals) {
      const minutes = Math.max(0, Math.round((arrival.epoch * 1000 - Date.now()) / 60_000));
      const item = document.createElement('li');
      item.className = 'arrival-time';
      item.dataset.direction = group.direction;
      const direction = document.createElement('span');
      direction.className = 'arrival-direction';
      direction.textContent = group.direction || '?';
      const time = document.createElement('span');
      time.textContent = minutes < 1 ? 'Due' : `${minutes} min`;
      item.append(direction, time);
      list.append(item);
    }
    section.append(list);
    card.append(section);
  }
}

async function refreshView(view, getAlerts, getArrivals, findAlerts, findArrivals) {
  const favorites = favoritesByMode[view.mode];
  if (view.refreshButton.disabled || !favorites.length || !view.data) return;
  view.refreshButton.disabled = true;
  const feedCache = new Map();

  try {
    const alertResult = getAlerts(feedCache).then(
      (alerts) => ({ alerts }),
      (error) => ({ error })
    );
    await Promise.all(favorites.map(async (favorite) => {
      const card = [...view.favoritesContainer.children]
        .find((element) => element.dataset.favoriteId === favorite.id);
      if (!card) return;
      card.querySelector('.arrival-status, .arrival-groups')?.remove();

      const alertUpdate = alertResult.then((result) => {
        if (result.error) {
          card.classList.remove('has-alert');
          card.querySelector('.service-alerts, .service-alert-error')?.remove();
          const status = document.createElement('p');
          status.className = 'service-alert-error';
          status.textContent = result.error instanceof Error
            ? `${view.mode === 'bus' ? 'Bus' : 'Subway'} alerts unavailable: ${result.error.message}`
            : `${view.mode === 'bus' ? 'Bus' : 'Subway'} alerts unavailable.`;
          card.append(status);
          return;
        }

        renderServiceAlerts(card, findAlerts(result.alerts, favorite));
      });

      const arrivalUpdate = (async () => {
        setArrivalStatus(card, 'Loading arrivals...');
        try {
          const feed = await getArrivals(favorite, feedCache);
          const arrivals = findArrivals(feed, favorite);
          card.querySelector('.arrival-status')?.remove();
          if (!arrivals.length) {
            setArrivalStatus(card, 'No upcoming predictions at this stop.');
            return;
          }

          const groups = document.createElement('div');
          groups.className = 'arrival-groups';
          card.append(groups);
          renderArrivalGroups(groups, arrivals);
        } catch (error) {
          card.querySelector('.arrival-status')?.remove();
          setArrivalStatus(card, error instanceof Error
            ? `${view.mode === 'bus' ? 'Bus' : 'Subway'} arrivals unavailable: ${error.message}`
            : `Unable to load ${view.mode} arrivals.`, true);
        }
      })();

      await Promise.all([alertUpdate, arrivalUpdate]);
    }));
  } finally {
    view.refreshButton.disabled = false;
  }
}

function refreshSubway() {
  return refreshView(
    views.subway,
    fetchServiceAlerts,
    (favorite, feedCache) => {
      const group = ROUTE_FEED_GROUP[favorite.routeId];
      if (!group) throw new Error('Realtime predictions are not available for this route.');
      return fetchFeed(group, feedCache);
    },
    findSubwayServiceAlerts,
    findSubwayArrivals
  );
}

function refreshBus() {
  return refreshView(
    views.bus,
    fetchBusAlerts,
    (_favorite, feedCache) => fetchBusFeed('tripUpdates', feedCache),
    findBusServiceAlerts,
    findBusArrivals
  );
}

function refreshTrackedModes() {
  return Promise.all([
    favoritesByMode.subway.length ? refreshSubway() : Promise.resolve(),
    favoritesByMode.bus.length ? refreshBus() : Promise.resolve()
  ]);
}

function selectMode(mode) {
  for (const [viewMode, view] of Object.entries(views)) {
    const selected = viewMode === mode;
    view.panel.hidden = !selected;
    const tab = viewMode === 'subway' ? subwayTab : busTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  if (!views[mode].data) {
    loadModeData(mode);
  } else if (mode === 'subway') {
    refreshSubway();
  } else {
    refreshBus();
  }
}

subwayTab.addEventListener('click', () => selectMode('subway'));
busTab.addEventListener('click', () => selectMode('bus'));
subwayTab.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') {
    busTab.focus();
    selectMode('bus');
  }
});
busTab.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    subwayTab.focus();
    selectMode('subway');
  }
});
for (const mode of Object.keys(views)) {
  views[mode].addButton.addEventListener('click', () => addFavorite(mode));
}
views.subway.refreshButton.addEventListener('click', refreshSubway);
views.bus.refreshButton.addEventListener('click', refreshBus);

async function loadFavorites() {
  const storedValues = await chrome.storage.local.get([
    SUBWAY_FAVORITES_KEY,
    BUS_FAVORITES_KEY,
    LEGACY_FAVORITES_KEY
  ]);
  const oldFavorites = storedValues[LEGACY_FAVORITES_KEY] || [];
  favoritesByMode.subway = storedValues[SUBWAY_FAVORITES_KEY]
    || oldFavorites.filter((favorite) => !favorite.mode || favorite.mode === 'subway');
  favoritesByMode.bus = storedValues[BUS_FAVORITES_KEY]
    || oldFavorites.filter((favorite) => favorite.mode === 'bus');

  chrome.storage.local.set({
    [SUBWAY_FAVORITES_KEY]: favoritesByMode.subway,
    [BUS_FAVORITES_KEY]: favoritesByMode.bus
  });
  if (oldFavorites.length) chrome.storage.local.remove(LEGACY_FAVORITES_KEY);

  for (const mode of Object.keys(views)) {
    if (!views[mode].data) continue;
    renderFavorites(mode);
    if (favoritesByMode[mode].length) {
      if (mode === 'subway') refreshSubway();
      else refreshBus();
    }
  }
}

async function loadModeData(mode) {
  const view = views[mode];
  if (loadingModes.has(mode) || view.data) return;
  loadingModes.add(mode);
  view.addButton.disabled = true;
  view.loadStatus.removeAttribute('data-error');
  view.loadStatus.textContent = `Loading ${mode} routes and stops...`;
  try {
    view.data = mode === 'subway' ? await loadSubwayData() : await loadBusData();
    initializeView(mode);
    renderFavorites(mode);
    if (favoritesByMode[mode].length) {
      if (mode === 'subway') refreshSubway();
      else refreshBus();
    }
  } catch (error) {
    view.loadStatus.dataset.error = 'true';
    view.loadStatus.textContent = error instanceof Error
      ? `Unable to load ${mode} data: ${error.message}`
      : `Unable to load ${mode} data.`;
    view.addButton.disabled = true;
  } finally {
    loadingModes.delete(mode);
  }
}

Promise.allSettled([
  loadModeData('subway'),
  loadModeData('bus'),
  loadFavorites().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unable to load saved stops.';
    for (const view of Object.values(views)) {
      view.loadStatus.textContent = `Saved stops unavailable: ${message}`;
    }
  })
]);
window.setInterval(refreshTrackedModes, REFRESH_INTERVAL_MS);