import * as GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const FAVORITES_STORAGE_KEY = 'trackedStops';
const FEEDS_PATH = 'gtfs_subway/realtime_feed_apis.txt';
const STOPS_PATH = 'gtfs_subway/stops.txt';
const ROUTES_PATH = 'gtfs_subway/routes.txt';
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

const stationSearch = document.querySelector('#station-search');
const stationSelect = document.querySelector('#station-select');
const routeSelect = document.querySelector('#route-select');
const addButton = document.querySelector('#add-button');
const refreshButton = document.querySelector('#refresh-button');
const loadStatus = document.querySelector('#load-status');
const favoritesContainer = document.querySelector('#favorites');
const emptyState = document.querySelector('#empty-state');

let stations = [];
let stopsByStation = new Map();
let routesById = new Map();
let feedUrlsByGroup = new Map();
let favorites = [];

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
  const [stopsText, routesText, feedsText] = await Promise.all([
    loadText(STOPS_PATH),
    loadText(ROUTES_PATH),
    loadText(FEEDS_PATH)
  ]);
  const stops = parseCsv(stopsText);
  const routes = parseCsv(routesText);
  const rootStops = stops.filter((stop) => stop.location_type === '1' || !stop.parent_station);

  stations = [...new Map(rootStops.map((stop) => [stop.stop_id, stop])).values()]
    .sort((left, right) => left.stop_name.localeCompare(right.stop_name));
  stopsByStation = new Map(stations.map((station) => [station.stop_id, new Set([station.stop_id])]));
  for (const stop of stops) {
    if (stop.parent_station && stopsByStation.has(stop.parent_station)) {
      stopsByStation.get(stop.parent_station).add(stop.stop_id);
    }
  }

  routesById = new Map(routes.map((route) => [route.route_id, route]));
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

  populateStationSelect();
  populateRouteSelect();
  loadStatus.textContent = `${stations.length.toLocaleString()} stations loaded.`;
}

function populateStationSelect() {
  const search = stationSearch.value.trim().toLocaleLowerCase();
  const previousValue = stationSelect.value;
  const filteredStations = stations.filter((station) => station.stop_name.toLocaleLowerCase().includes(search));
  stationSelect.replaceChildren();

  for (const station of filteredStations) {
    const option = document.createElement('option');
    option.value = station.stop_id;
    option.textContent = station.stop_name;
    stationSelect.append(option);
  }

  if (filteredStations.some((station) => station.stop_id === previousValue)) {
    stationSelect.value = previousValue;
  }
}

function populateRouteSelect() {
  routeSelect.replaceChildren();
  const routes = [...routesById.values()].sort((left, right) => {
    const leftOrder = Number(left.route_sort_order) || 0;
    const rightOrder = Number(right.route_sort_order) || 0;
    return leftOrder - rightOrder || left.route_short_name.localeCompare(right.route_short_name);
  });

  for (const route of routes) {
    const option = document.createElement('option');
    option.value = route.route_id;
    option.textContent = route.route_short_name;
    routeSelect.append(option);
  }
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
  const station = stations.find((item) => item.stop_id === stationSelect.value);
  const route = routesById.get(routeSelect.value);
  if (!station || !route) return;

  const id = `${station.stop_id}:${route.route_id}`;
  if (favorites.some((favorite) => favorite.id === id)) {
    loadStatus.textContent = 'That station and route are already tracked.';
    return;
  }

  favorites = [...favorites, {
    id,
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
    const route = routesById.get(favorite.routeId);
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
    removeButton.addEventListener('click', () => removeFavorite(favorite.id));
    header.append(badge, name, removeButton);
    card.append(header);
    favoritesContainer.append(card);
  }
}

function getEpochSeconds(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  return Number(value);
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

function findArrivals(feed, favorite) {
  const stationStopIds = stopsByStation.get(favorite.stationId) || new Set([favorite.stationId]);
  const selectedRouteId = canonicalRoute(favorite.routeId);
  const now = Date.now() / 1000;
  const arrivals = [];

  for (const entity of feed.entity || []) {
    const update = entity.tripUpdate;
    if (!update) continue;
    const tripRouteId = update.trip?.routeId;
    if (!tripRouteId || canonicalRoute(tripRouteId) !== selectedRouteId) continue;

    for (const stopUpdate of update.stopTimeUpdate || []) {
      if (!stationStopIds.has(stopUpdate.stopId)) continue;
      if (stopUpdate.scheduleRelationship === 1) continue;
      const epoch = getEpochSeconds(stopUpdate.arrival?.time ?? stopUpdate.departure?.time);
      if (!Number.isFinite(epoch) || epoch < now - 30 || epoch > now + 2 * 60 * 60) continue;
      arrivals.push({ epoch, tripId: update.trip?.tripId || entity.id });
    }
  }

  const uniqueArrivals = new Map();
  for (const arrival of arrivals) uniqueArrivals.set(`${arrival.tripId}:${arrival.epoch}`, arrival);
  return [...uniqueArrivals.values()].sort((left, right) => left.epoch - right.epoch).slice(0, 4);
}

async function refreshArrivals() {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  const feedCache = new Map();

  try {
    await Promise.all(favorites.map(async (favorite) => {
      const card = [...favoritesContainer.children]
        .find((element) => element.dataset.favoriteId === favorite.id);
      if (!card) return;
      card.querySelector('.arrival-status, .arrival-list')?.remove();

      const group = ROUTE_FEED_GROUP[favorite.routeId];
      if (!group) {
        setArrivalStatus(card, 'Realtime predictions are not available for this route.');
        return;
      }

      setArrivalStatus(card, 'Loading arrivals...');
      try {
        const feed = await fetchFeed(group, feedCache);
        const arrivals = findArrivals(feed, favorite);
        card.querySelector('.arrival-status')?.remove();
        if (!arrivals.length) {
          setArrivalStatus(card, 'No upcoming predictions at this stop.');
          return;
        }

        const list = document.createElement('ul');
        list.className = 'arrival-list';
        for (const arrival of arrivals) {
          const minutes = Math.max(0, Math.round((arrival.epoch * 1000 - Date.now()) / 60_000));
          const item = document.createElement('li');
          item.className = 'arrival-time';
          item.textContent = minutes < 1 ? 'Due' : `${minutes} min`;
          list.append(item);
        }
        card.append(list);
      } catch (error) {
        card.querySelector('.arrival-status')?.remove();
        setArrivalStatus(card, error instanceof Error ? error.message : 'Unable to load arrivals.');
      }
    }));
  } finally {
    refreshButton.disabled = false;
  }
}

stationSearch.addEventListener('input', populateStationSelect);
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