import * as GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const FAVORITES_STORAGE_KEY = 'trackedStops';
const FEEDS_PATH = 'gtfs_subway/realtime_feed_apis.txt';
const SERVICE_ALERT_FEEDS_PATH = 'gtfs_subway/service_alert_feeds.txt';
const STOPS_PATH = 'gtfs_subway/stops.txt';
const ROUTES_PATH = 'gtfs_subway/routes.txt';
const BUS_STOPS_PATH = 'gtfs_bus/stops.txt';
const BUS_ROUTES_PATH = 'gtfs_bus/routes.txt';
const REFRESH_INTERVAL_MS = 15_000;
const ROUTE_FEED_GROUP = {
  A: 'ACE', C: 'ACE', E: 'ACE',
  B: 'BDFM', D: 'BDFM', F: 'BDFM', FX: 'BDFM', M: 'BDFM',
  G: 'G', J: 'JZ', Z: 'JZ', L: 'L',
  N: 'NQRW', Q: 'NQRW', R: 'NQRW', W: 'NQRW',
  1: '1234567', 2: '1234567', 3: '1234567', 4: '1234567',
  5: '1234567', 6: '1234567', '6X': '1234567', 7: '1234567', '7X': '1234567',
  SI: 'SI', SIR: 'SI'
};

const stationInput = document.querySelector('#station-input');
const stationOptions = document.querySelector('#station-options');
const routeInput = document.querySelector('#route-input');
const routeOptions = document.querySelector('#route-options');
const modeInput = document.querySelector('#mode-input');
const addButton = document.querySelector('#add-button');
const refreshButton = document.querySelector('#refresh-button');
const loadStatus = document.querySelector('#load-status');
const favoritesContainer = document.querySelector('#favorites');
const emptyState = document.querySelector('#empty-state');

let transitDataByMode = new Map();
let feedUrlsByGroup = new Map();
let busFeedUrls = {};
let serviceAlertFeedUrls = [];
let favorites = [];
let updateStationPicker = () => {};
let updateRoutePicker = () => {};

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
  if (!response.ok) throw new Error(`Unable to read ${path}.`);
  return response.text();
}

async function loadData() {
  const [stopsText, routesText, feedsText, serviceAlertFeedsText, busStopsText, busRoutesText] = await Promise.all([
    loadText(STOPS_PATH),
    loadText(ROUTES_PATH),
    loadText(FEEDS_PATH),
    loadText(SERVICE_ALERT_FEEDS_PATH),
    loadText(BUS_STOPS_PATH),
    loadText(BUS_ROUTES_PATH)
  ]);
  transitDataByMode = new Map([
    ['subway', buildTransitData(stopsText, routesText)],
    ['bus', buildTransitData(busStopsText, busRoutesText)]
  ]);
  busFeedUrls = globalThis.NYC_BUS_FEED_URLS || {};

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

  updateStationPicker = attachPicker(stationInput, stationOptions, [], () => '', (station) => station.stop_id);
  updateRoutePicker = attachPicker(routeInput, routeOptions, [], (route) => '', (route) => route.route_id);
  modeInput.addEventListener('change', updateTransitMode);
  updateTransitMode();
  const subwayData = transitDataByMode.get('subway');
  const busData = transitDataByMode.get('bus');
  loadStatus.textContent = `${subwayData.stations.length.toLocaleString()} subway stations and ${busData.stations.length.toLocaleString()} bus stops loaded.`;
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

function updateTransitMode() {
  const mode = modeInput.value === 'bus' ? 'bus' : 'subway';
  const data = transitDataByMode.get(mode);
  if (!data) return;
  updateStationPicker(data.stations, (station) => data.stationLabels.get(station.stop_id), (station) => station.stop_id);
  updateRoutePicker(
    [...data.routesById.values()],
    (route) => `${route.route_short_name} · ${route.route_long_name}`,
    (route) => route.route_id
  );
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

function addFavorite() {
  const mode = modeInput.value === 'bus' ? 'bus' : 'subway';
  const data = transitDataByMode.get(mode);
  const station = data?.stationById.get(stationInput.dataset.selectedId);
  const route = data?.routesById.get(routeInput.dataset.selectedId);
  if (!station || !route) {
    loadStatus.textContent = 'Choose a station and route from the search results.';
    return;
  }

  const id = `${mode}:${station.stop_id}:${route.route_id}`;
  if (favorites.some((favorite) => (
    (favorite.mode || 'subway') === mode
    && favorite.stationId === station.stop_id
    && favorite.routeId === route.route_id
  ))) {
    loadStatus.textContent = 'That station and route are already tracked.';
    return;
  }

  favorites = [...favorites, {
    id,
    mode,
    stationId: station.stop_id,
    stationName: station.stop_name,
    routeId: route.route_id
  }];
  chrome.storage.local.set({ [FAVORITES_STORAGE_KEY]: favorites });
  renderFavorites();
  loadStatus.textContent = 'Stop added.';
  refreshArrivals();
}

function removeFavorite(id) {
  favorites = favorites.filter((favorite) => favorite.id !== id);
  chrome.storage.local.set({ [FAVORITES_STORAGE_KEY]: favorites });
  renderFavorites();
}

function setArrivalStatus(container, message) {
  const status = document.createElement('p');
  status.className = 'arrival-status';
  status.textContent = message;
  container.append(status);
}

function renderFavorites() {
  favoritesContainer.replaceChildren();
  emptyState.hidden = favorites.length > 0;

  for (const favorite of favorites) {
    const mode = favorite.mode === 'bus' ? 'bus' : 'subway';
    const route = transitDataByMode.get(mode)?.routesById.get(favorite.routeId);
    const card = document.createElement('article');
    card.className = 'favorite';
    card.dataset.favoriteId = favorite.id;
    card.dataset.mode = mode;
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
    removeButton.addEventListener('click', () => removeFavorite(favorite.id));
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
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MTA feed returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  })();
  feedCache.set(group, request);
  return request;
}

async function fetchServiceAlerts() {
  const feeds = await Promise.all(serviceAlertFeedUrls.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`MTA service alert feed returned HTTP ${response.status}.`);
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
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`MTA bus feed returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  })();
  feedCache.set(cacheKey, request);
  return request;
}

async function fetchFavoriteAlerts(mode, feedCache) {
  if (mode === 'bus') {
    const feed = await fetchBusFeed('alerts', feedCache);
    return (feed.entity || []).filter((entity) => entity.alert).map((entity) => ({
      ...entity.alert,
      id: entity.id
    }));
  }
  return fetchServiceAlerts();
}

function isAlertActive(alert, now) {
  const periods = alert.activePeriod || [];
  return !periods.length || periods.some((period) => {
    const startsInTime = period.start == null || getEpochSeconds(period.start) <= now;
    const hasNotEnded = period.end == null || getEpochSeconds(period.end) >= now;
    return startsInTime && hasNotEnded;
  });
}

function findServiceAlerts(alerts, favorite) {
  const mode = favorite.mode === 'bus' ? 'bus' : 'subway';
  const data = transitDataByMode.get(mode);
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

function findArrivals(feed, favorite) {
  const mode = favorite.mode === 'bus' ? 'bus' : 'subway';
  const data = transitDataByMode.get(mode);
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

async function refreshArrivals() {
  if (refreshButton.disabled || !favorites.length) return;
  refreshButton.disabled = true;
  const feedCache = new Map();
  const alertResults = new Map([...new Set(favorites.map((favorite) => favorite.mode === 'bus' ? 'bus' : 'subway'))]
    .map((mode) => [mode, fetchFavoriteAlerts(mode, feedCache).then(
      (alerts) => ({ alerts }),
      (error) => ({ error })
    )]));

  try {
    await Promise.all(favorites.map(async (favorite) => {
      const mode = favorite.mode === 'bus' ? 'bus' : 'subway';
      const card = [...favoritesContainer.children]
        .find((element) => element.dataset.favoriteId === favorite.id);
      if (!card) return;
      card.querySelector('.arrival-status, .arrival-groups')?.remove();

      const alertUpdate = alertResults.get(mode).then((result) => {
        if (result.error) {
          card.classList.remove('has-alert');
          card.querySelector('.service-alerts, .service-alert-error')?.remove();
          const status = document.createElement('p');
          status.className = 'service-alert-error';
          status.textContent = result.error instanceof Error
            ? `Service alerts unavailable: ${result.error.message}`
            : 'Service alerts unavailable.';
          card.append(status);
          return;
        }

        renderServiceAlerts(card, findServiceAlerts(result.alerts, favorite));
      });

      const arrivalUpdate = (async () => {
        const group = mode === 'subway' ? ROUTE_FEED_GROUP[favorite.routeId] : null;
        if (mode === 'subway' && !group) {
          setArrivalStatus(card, 'Realtime predictions are not available for this route.');
          return;
        }

        setArrivalStatus(card, 'Loading arrivals...');
        try {
          const feed = mode === 'bus'
            ? await fetchBusFeed('tripUpdates', feedCache)
            : await fetchFeed(group, feedCache);
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
          setArrivalStatus(card, error instanceof Error ? error.message : 'Unable to load arrivals.');
        }
      })();

      await Promise.all([alertUpdate, arrivalUpdate]);
    }));
  } finally {
    refreshButton.disabled = false;
  }
}

addButton.addEventListener('click', addFavorite);
refreshButton.addEventListener('click', refreshArrivals);

Promise.all([
  loadData(),
  chrome.storage.local.get(FAVORITES_STORAGE_KEY).then((values) => {
    favorites = values[FAVORITES_STORAGE_KEY] || [];
  })
]).then(() => {
  renderFavorites();
  refreshArrivals();
  window.setInterval(refreshArrivals, REFRESH_INTERVAL_MS);
}).catch((error) => {
  loadStatus.textContent = error instanceof Error ? error.message : 'Unable to load subway data.';
  addButton.disabled = true;
});