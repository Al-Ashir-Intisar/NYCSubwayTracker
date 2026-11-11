import * as GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import Fuse from 'fuse.js';
import { Reader } from 'protobufjs/minimal';
import {
  PATH_ALERTS_URL, PATH_FEED_URL, buildPathData, findPathAlerts, findPathArrivals
} from './path.js';
// Resolved by the build to src/platform/extension.js or src/platform/web.js.
import {
  apiUrl, assetUrl, feedUrl, storage
} from 'platform';

const SUBWAY_FAVORITES_KEY = 'trackedSubwayStops';
const BUS_FAVORITES_KEY = 'trackedBusStops';
const PATH_FAVORITES_KEY = 'trackedPathStops';
const FAVORITES_KEYS = {
  subway: SUBWAY_FAVORITES_KEY,
  bus: BUS_FAVORITES_KEY,
  path: PATH_FAVORITES_KEY
};
const LEGACY_FAVORITES_KEY = 'trackedStops';
const LAST_MODE_KEY = 'lastTab';
const PATH_ALERTS_COLLAPSED_KEY = 'pathAlertsCollapsed';
const FEEDS_PATH = 'gtfs_subway/realtime_feed_apis.txt';
const SERVICE_ALERT_FEEDS_PATH = 'gtfs_subway/service_alert_feeds.txt';
const STOPS_PATH = 'gtfs_subway/stops.txt';
const ROUTES_PATH = 'gtfs_subway/routes.txt';
const BUS_STOPS_PATH = 'gtfs_bus/stops.txt';
const BUS_ROUTES_PATH = 'gtfs_bus/routes.txt';
const REFRESH_INTERVAL_MS = 30_000;
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
const pathTab = document.querySelector('#path-tab');
const views = {
  subway: {
    mode: 'subway',
    label: 'Subway',
    stopNoun: 'station',
    routeNoun: 'route',
    tab: subwayTab,
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
    label: 'Bus',
    stopNoun: 'bus stop',
    routeNoun: 'route',
    tab: busTab,
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
  },
  path: {
    mode: 'path',
    label: 'PATH',
    stopNoun: 'station',
    routeNoun: 'direction',
    routeLabel: (direction) => direction.route_long_name,
    pickerLimit: 20, // few enough stations to list them all
    tab: pathTab,
    panel: document.querySelector('#path-panel'),
    stationInput: document.querySelector('#path-station-input'),
    stationOptions: document.querySelector('#path-station-options'),
    routeInput: document.querySelector('#path-route-input'),
    routeOptions: document.querySelector('#path-route-options'),
    addButton: document.querySelector('#path-add-button'),
    refreshButton: document.querySelector('#path-refresh-button'),
    loadStatus: document.querySelector('#path-load-status'),
    favoritesContainer: document.querySelector('#path-favorites'),
    emptyState: document.querySelector('#path-empty-state'),
    data: null
  }
};

let feedUrlsByGroup = new Map();
let serviceAlertFeedUrls = [];
const favoritesByMode = { subway: [], bus: [], path: [] };
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
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`Unable to read ${path} (HTTP ${response.status}).`);
  return response.text();
}

async function fetchFeedResponse(url, feedName) {
  let response;
  try {
    response = await fetch(feedUrl(url), {
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
  return buildBusData(stopsText, routesText);
}

async function loadPathData() {
  return buildPathData();
}

function initializeView(mode) {
  const view = views[mode];
  const { data } = view;
  attachPicker(view.stationInput, view.stationOptions, data.stations,
    (station) => data.stationLabels.get(station.stop_id), (station) => station.stop_id, view.pickerLimit);
  attachPicker(view.routeInput, view.routeOptions, [...data.routesById.values()],
    view.routeLabel || ((route) => `${route.route_short_name} · ${route.route_long_name}`),
    (route) => route.route_id, view.pickerLimit);
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

function attachPicker(input, list, items, labelFor, idFor, maxResults = 12) {
  let matches = [];
  let activeIndex = -1;
  let fuse = new Fuse(items.map(labelFor));

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
    const query = input.value.trim();
    matches = (query
      ? fuse.search(query).map((result) => items[result.refIndex])
      : items).slice(0, maxResults);
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
    fuse = new Fuse(items.map(labelFor));
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
    view.loadStatus.textContent = `Choose a ${view.stopNoun} and ${view.routeNoun} from the search results.`;
    return;
  }

  const id = `${station.stop_id}:${route.route_id}`;
  if (favoritesByMode[mode].some((favorite) => (
    favorite.stationId === station.stop_id
    && favorite.routeId === route.route_id
  ))) {
    view.loadStatus.textContent = `That ${view.stopNoun} and ${view.routeNoun} are already tracked.`;
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
  refreshMode(mode);
}

function persistFavorites(mode) {
  storage.set({ [FAVORITES_KEYS[mode]]: favoritesByMode[mode] });
}

function removeFavorite(mode, id) {
  favoritesByMode[mode] = favoritesByMode[mode].filter((favorite) => favorite.id !== id);
  persistFavorites(mode);
  findCard(mode, id)?.remove();
  views[mode].emptyState.hidden = favoritesByMode[mode].length > 0;
  updateMoveButtons(mode);
}

function findCard(mode, id) {
  return [...views[mode].favoritesContainer.children].find((element) => element.dataset.favoriteId === id);
}

function setCollapsed(mode, id, collapsed) {
  const favorite = favoritesByMode[mode].find((item) => item.id === id);
  if (!favorite) return;
  favorite.collapsed = collapsed;
  persistFavorites(mode);
  const card = findCard(mode, id);
  card?.classList.toggle('collapsed', collapsed);
  card?.querySelector('.card-toggle')?.setAttribute('aria-expanded', String(!collapsed));
}

// Cards move in place, so their arrivals stay on screen until the next refresh.
function moveFavorite(mode, id, step) {
  const favorites = favoritesByMode[mode];
  const index = favorites.findIndex((favorite) => favorite.id === id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= favorites.length) return;
  [favorites[index], favorites[target]] = [favorites[target], favorites[index]];
  persistFavorites(mode);

  const card = findCard(mode, id);
  const neighbor = findCard(mode, favorites[index].id);
  if (step < 0) neighbor.before(card);
  else neighbor.after(card);
  updateMoveButtons(mode);
  // Moving the card can drop focus; keep it on the same button, or its partner at the ends.
  const button = card.querySelector(step < 0 ? '.move-up' : '.move-down');
  (button.disabled ? card.querySelector(step < 0 ? '.move-down' : '.move-up') : button)?.focus();
}

function updateMoveButtons(mode) {
  const cards = [...views[mode].favoritesContainer.children];
  cards.forEach((card, index) => {
    card.querySelector('.move-up').disabled = index === 0;
    card.querySelector('.move-down').disabled = index === cards.length - 1;
  });
}

function setArrivalStatus(container, message, isError = false) {
  const status = document.createElement('p');
  status.className = isError ? 'arrival-status arrival-error' : 'arrival-status';
  status.textContent = message;
  container.append(status);
}

function createActionButton(className, text, label, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function renderFavorites(mode) {
  const view = views[mode];
  const favorites = favoritesByMode[mode];
  view.favoritesContainer.replaceChildren();
  view.emptyState.hidden = favorites.length > 0;

  for (const favorite of favorites) {
    const route = view.data.routesById.get(favorite.routeId);
    const routeName = mode === 'path' ? route?.route_long_name : favorite.routeId;
    const cardLabel = `${routeName} at ${favorite.stationName}`;
    const card = document.createElement('article');
    card.className = favorite.collapsed ? 'favorite collapsed' : 'favorite';
    card.dataset.favoriteId = favorite.id;
    card.style.setProperty('--route-color', routeColor(route));
    card.style.setProperty('--route-text', routeTextColor(route));

    // The whole header is the expand/collapse control; a collapsed card keeps the next
    // arrivals in it (see renderArrivalSummary).
    const header = document.createElement('div');
    header.className = 'favorite-header';
    const name = document.createElement('h3');
    name.className = 'station-name';
    const toggle = document.createElement('button');
    toggle.className = 'card-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!favorite.collapsed));
    const badge = document.createElement('span');
    badge.className = 'route-badge';
    badge.textContent = route?.route_short_name || favorite.routeId;
    const title = document.createElement('span');
    title.className = 'card-title';
    const stationName = document.createElement('span');
    stationName.textContent = favorite.stationName;
    const summary = document.createElement('span');
    summary.className = 'arrival-summary';
    title.append(stationName, summary);
    const chevron = document.createElement('span');
    chevron.className = 'card-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(badge, title, chevron);
    toggle.addEventListener('click', () => (
      setCollapsed(mode, favorite.id, !card.classList.contains('collapsed'))
    ));
    name.append(toggle);

    // Reordering and removing are occasional, so they sit behind a "more" button.
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.id = `${mode}-actions-${favorite.id}`;
    actions.hidden = true;
    actions.append(
      createActionButton('card-action move-up', 'Move up', `Move ${cardLabel} up`,
        () => moveFavorite(mode, favorite.id, -1)),
      createActionButton('card-action move-down', 'Move down', `Move ${cardLabel} down`,
        () => moveFavorite(mode, favorite.id, 1)),
      createActionButton('card-action remove-button', 'Remove', `Remove ${cardLabel}`,
        () => removeFavorite(mode, favorite.id))
    );
    const moreButton = createActionButton('more-button', '⋯', `Options for ${cardLabel}`, () => {
      actions.hidden = !actions.hidden;
      moreButton.setAttribute('aria-expanded', String(!actions.hidden));
    });
    moreButton.setAttribute('aria-expanded', 'false');
    moreButton.setAttribute('aria-controls', actions.id);

    header.append(name, moreButton);
    card.append(header, actions);
    view.favoritesContainer.append(card);
  }
  updateMoveButtons(mode);
}

// The soonest arrival in each direction (or to each destination when there is no
// direction), for the header of a collapsed card. PATH lines share a direction, so their
// color keeps them apart.
function renderArrivalSummary(card, arrivals, message = '') {
  const summary = card.querySelector('.arrival-summary');
  if (!summary) return;
  summary.replaceChildren();
  if (message) {
    summary.textContent = message;
    return;
  }
  const soonest = new Map();
  for (const arrival of arrivals) {
    const key = arrival.direction ? `${arrival.direction}:${arrival.color || ''}` : arrival.destination;
    if (!soonest.has(key)) soonest.set(key, arrival);
  }
  for (const arrival of [...soonest.values()].slice(0, 3)) {
    const minutes = Math.max(0, Math.round((arrival.epoch * 1000 - Date.now()) / 60_000));
    const item = document.createElement('span');
    item.className = 'summary-time';
    item.dataset.direction = arrival.direction;
    if (arrival.direction) {
      const marker = document.createElement('span');
      marker.className = 'arrival-direction';
      marker.textContent = arrival.direction;
      colorMarker(marker, arrival.color);
      item.append(marker);
    }
    item.append(minutes < 1 ? 'Due' : `${minutes} min`);
    summary.append(item);
  }
}

// Some feeds (buses) only send HTML-formatted text, with entities and zero-width characters.
function toPlainText(text) {
  if (!/[<&]/.test(text)) return text.trim();
  const breaks = text.replace(/<\/(p|li|ul|div)>|<br\s*\/?>/gi, '\n');
  const parsed = new DOMParser().parseFromString(breaks, 'text/html').body.textContent || '';
  return parsed
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getTranslatedText(translatedString) {
  const translations = translatedString?.translation || [];
  const isLanguage = (translation, language) => translation.language?.toLowerCase() === language;
  const text = translations.find((translation) => isLanguage(translation, 'en'))?.text
    || translations.find((translation) => !translation.language?.toLowerCase().endsWith('-html'))?.text
    || '';
  return toPlainText(text);
}

// MTA descriptions include a "What's happening?" line that names the reason in a few words.
function getAlertSummary(alert) {
  return getTranslatedText(alert.descriptionText)
    .match(/What['’]s happening\?\s*\n+([^\n]+)/i)?.[1].trim() || '';
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

// The MTA tags each alert with a type string (e.g. "Planned - Express to Local") in its
// Mercury extension (Alert field 1001, alert_type = 3). The standard bindings drop unknown
// extensions, so read it from the raw bytes and match it back to alerts by entity id.
function readMercuryAlertTypes(bytes) {
  const types = new Map();
  const walk = (buffer, onField) => {
    const reader = new Reader(buffer);
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      onField(tag >>> 3, tag & 7, reader);
    }
  };
  try {
    walk(bytes, (field, wire, reader) => {
      if (field !== 2) return reader.skipType(wire);
      let id = '';
      let alertType = '';
      walk(reader.bytes(), (entityField, entityWire, entityReader) => {
        if (entityField === 1) id = entityReader.string();
        else if (entityField === 5) {
          walk(entityReader.bytes(), (alertField, alertWire, alertReader) => {
            if (alertField !== 1001) return alertReader.skipType(alertWire);
            walk(alertReader.bytes(), (mercuryField, mercuryWire, mercuryReader) => {
              if (mercuryField === 3) alertType = mercuryReader.string();
              else mercuryReader.skipType(mercuryWire);
            });
          });
        } else entityReader.skipType(entityWire);
      });
      if (id && alertType) types.set(id, alertType);
    });
  } catch {
    // Without the extension alerts still render, just with the generic label.
  }
  return types;
}

async function fetchServiceAlerts() {
  const feeds = await Promise.all(serviceAlertFeedUrls.map(async (url) => {
    const response = await fetchFeedResponse(url, 'Subway alerts');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      feed: GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes),
      alertTypes: readMercuryAlertTypes(bytes)
    };
  }));
  return [...new Map(feeds.flatMap(({ feed, alertTypes }) => (feed.entity || [])
    .filter((entity) => entity.alert)
    .map((entity) => [entity.id, {
      ...entity.alert,
      id: entity.id,
      alertType: alertTypes.get(entity.id) || ''
    }]))).values()];
}

// Bus feeds need the MTA Bus Time API key, which only the Worker has. Predictions are asked
// for one stop and line at a time; the citywide trip-updates feed is several MB.
async function fetchBusStopMonitoring(favorite) {
  const route = views.bus.data.routesById.get(favorite.routeId);
  const query = new URLSearchParams({
    stop: favorite.stationId,
    line: `${route?.agency_id || 'MTA NYCT'}_${favorite.routeId}`
  });
  const response = await fetchFeedResponse(apiUrl(`/api/bus/stop-monitoring?${query}`), 'Bus data');
  const delivery = (await response.json()).Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0];
  const error = delivery?.ErrorCondition?.Description;
  if (error) throw new Error(error);
  return delivery?.MonitoredStopVisit || [];
}

// Only predicted times count; visits with just a scheduled (aimed) time are left out.
function findStopMonitoringArrivals(visits) {
  const now = Date.now() / 1000;
  return visits.map((visit) => {
    const journey = visit.MonitoredVehicleJourney || {};
    const call = journey.MonitoredCall || {};
    return {
      epoch: Date.parse(call.ExpectedArrivalTime || call.ExpectedDepartureTime || '') / 1000,
      direction: '',
      destination: journey.DestinationName?.[0] || 'Destination unavailable'
    };
  })
    .filter((arrival) => Number.isFinite(arrival.epoch) && arrival.epoch >= now - 30 && arrival.epoch <= now + 2 * 60 * 60)
    .sort((left, right) => left.epoch - right.epoch);
}

// The PATH feed is unofficial, so any failure gets one friendly explanation.
async function fetchPathFeed(feedCache) {
  if (feedCache.has('path')) return feedCache.get('path');

  const request = (async () => {
    let reason;
    try {
      const response = await fetchFeedResponse(PATH_FEED_URL, 'PATH arrivals');
      const feed = await response.json().catch(() => null);
      if (Array.isArray(feed?.results)) return feed;
      reason = 'PATH sent an unexpected response.';
    } catch (error) {
      reason = error instanceof Error ? error.message : 'PATH could not be reached.';
    }
    throw new Error(`${reason} This feed is unofficial and may be down; try again shortly.`);
  })();
  feedCache.set('path', request);
  return request;
}

async function fetchBusAlerts() {
  const response = await fetchFeedResponse(apiUrl('/api/bus/alerts'), 'Bus alerts');
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
  return (feed.entity || []).filter((entity) => entity.alert).map((entity) => ({
    ...entity.alert,
    id: entity.id
  }));
}

function isAlertActive(alert, now) {
  const periods = alert.activePeriod || [];
  return !periods.length || periods.some((period) => {
    // An unset start or end decodes as 0 (not null), meaning the period is open on that side.
    const start = getEpochSeconds(period.start);
    const end = getEpochSeconds(period.end);
    return (!start || start <= now) && (!end || end >= now);
  });
}

function matchServiceAlerts(alerts, favorite, mode) {
  const data = views[mode].data;
  const stationStopIds = data?.stopsByStation.get(favorite.stationId) || new Set([favorite.stationId]);
  const selectedRouteId = canonicalRoute(favorite.routeId);
  const now = Date.now() / 1000;
  // An alert applies if it covers this route and either names no stop (route-wide, which is
  // all the bus feed offers) or names this stop. Unset string fields decode as "".
  return alerts.filter((alert) => isAlertActive(alert, now)
    && (alert.informedEntity || []).some((selector) => {
      const selectorRouteId = selector.routeId || selector.trip?.routeId;
      return selectorRouteId
        && canonicalRoute(selectorRouteId) === selectedRouteId
        && (!selector.stopId || stationStopIds.has(selector.stopId));
    }));
}

function findSubwayServiceAlerts(alerts, favorite) {
  return matchServiceAlerts(alerts, favorite, 'subway');
}

// Headlines name lines like "[C]". An alert about another line can still matter to this one,
// e.g. "[C] is suspended - take the [A] instead" sends C riders to the A, which may then make
// extra stops. These show as a quiet note wherever the line is tracked, whatever the station.
// Descriptions are left out because they list transfers to many lines.
function findRelatedSubwayAlerts(alerts, favorite) {
  const selectedRouteId = canonicalRoute(favorite.routeId);
  const now = Date.now() / 1000;
  return alerts.filter((alert) => isAlertActive(alert, now)
    && [...getTranslatedText(alert.headerText).matchAll(/\[([A-Z0-9]{1,3})\]/g)]
      .some((match) => canonicalRoute(match[1]) === selectedRouteId)
    && !(alert.informedEntity || []).some((selector) => {
      const selectorRouteId = selector.routeId || selector.trip?.routeId;
      return selectorRouteId && canonicalRoute(selectorRouteId) === selectedRouteId;
    }));
}

function findBusServiceAlerts(alerts, favorite) {
  return matchServiceAlerts(alerts, favorite, 'bus');
}

function isDelayAlert(alert) {
  return alert.effect === GtfsRealtimeBindings.transit_realtime.Alert.Effect.SIGNIFICANT_DELAYS
    || /delay/i.test(getTranslatedText(alert.headerText));
}

function removeServiceAlerts(card) {
  card.querySelectorAll('.service-alerts, .service-alert-error, .related-alerts')
    .forEach((element) => element.remove());
}

// Related alerts (see findRelatedSubwayAlerts) don't highlight the card.
function renderServiceAlerts(card, alerts, relatedAlerts = []) {
  const expandedAlertIds = new Set(
    [...card.querySelectorAll('.service-alert[open]')].map((item) => item.dataset.alertId)
  );
  removeServiceAlerts(card);
  card.classList.toggle('has-alert', alerts.length > 0);
  if (alerts.length) card.append(buildAlertList('service-alerts', alerts, expandedAlertIds));
  if (relatedAlerts.length) {
    card.append(buildAlertList('related-alerts', relatedAlerts, expandedAlertIds, 'Related'));
  }
}

function buildAlertList(className, alerts, expandedAlertIds, labelText) {
  const container = document.createElement('div');
  container.className = className;
  for (const alert of alerts) {
    const details = document.createElement('details');
    details.className = 'service-alert';
    details.dataset.alertId = alert.id || '';
    details.open = expandedAlertIds.has(alert.id || '');

    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'service-alert-label';
    label.textContent = labelText || alert.alertType || getAlertSummary(alert)
      || (isDelayAlert(alert) ? 'Delays' : 'Service alert');
    const header = document.createElement('span');
    header.className = 'service-alert-header';
    header.textContent = getTranslatedText(alert.headerText) || 'Service change';
    summary.append(label, header);
    details.append(summary);

    const description = document.createElement('p');
    description.className = 'service-alert-description';
    const headerText = getTranslatedText(alert.headerText);
    const descriptionText = getTranslatedText(alert.descriptionText);
    description.textContent = (headerText && descriptionText.startsWith(headerText)
      ? descriptionText.slice(headerText.length).trim()
      : descriptionText) || 'No additional details provided.';
    details.append(description);
    container.append(details);
  }
  return container;
}

function findSubwayArrivals(feed, favorite) {
  const data = views.subway.data;
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
      const direction = stopUpdate.stopId.endsWith('N') ? 'N' : stopUpdate.stopId.endsWith('S') ? 'S' : '';
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

// Black or white, whichever reads better on a line color (WCAG contrast).
function readableTextColor(hex) {
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05 ? '#ffffff' : '#1a1a1a';
}

function colorMarker(element, color) {
  if (!color) return;
  element.style.background = `#${color}`;
  element.style.color = readableTextColor(color);
}

function renderArrivalGroups(card, arrivals) {
  const groups = new Map();
  for (const arrival of arrivals) {
    // PATH lines share a destination, so the line color is part of the grouping.
    const key = `${arrival.direction}:${arrival.destination}:${arrival.color || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        direction: arrival.direction,
        destination: arrival.destination,
        color: arrival.color,
        arrivals: []
      });
    }
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
    colorMarker(marker, group.color);
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
      colorMarker(direction, group.color);
      const time = document.createElement('span');
      time.textContent = minutes < 1 ? 'Due' : `${minutes} min`;
      item.append(direction, time);
      list.append(item);
    }
    section.append(list);
    card.append(section);
  }
}

async function refreshView(view, getAlerts, getArrivals, findAlerts, findArrivals, findRelatedAlerts = () => []) {
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
          removeServiceAlerts(card);
          const status = document.createElement('p');
          status.className = 'service-alert-error';
          status.textContent = result.error instanceof Error
            ? `${view.label} alerts unavailable: ${result.error.message}`
            : `${view.label} alerts unavailable.`;
          card.append(status);
          return;
        }

        renderServiceAlerts(card, findAlerts(result.alerts, favorite), findRelatedAlerts(result.alerts, favorite));
      });

      const arrivalUpdate = (async () => {
        setArrivalStatus(card, 'Loading arrivals...');
        try {
          const feed = await getArrivals(favorite, feedCache);
          const arrivals = findArrivals(feed, favorite);
          card.querySelector('.arrival-status')?.remove();
          if (!arrivals.length) {
            setArrivalStatus(card, 'No upcoming predictions at this stop.');
            renderArrivalSummary(card, [], 'No predictions');
            return;
          }
          renderArrivalSummary(card, arrivals);

          const groups = document.createElement('div');
          groups.className = 'arrival-groups';
          card.append(groups);
          renderArrivalGroups(groups, arrivals);
        } catch (error) {
          card.querySelector('.arrival-status')?.remove();
          renderArrivalSummary(card, [], 'Arrivals unavailable');
          setArrivalStatus(card, error instanceof Error
            ? `${view.label} arrivals unavailable: ${error.message}`
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
    findSubwayArrivals,
    findRelatedSubwayAlerts
  );
}

function refreshBus() {
  return refreshView(
    views.bus,
    fetchBusAlerts,
    fetchBusStopMonitoring,
    findBusServiceAlerts,
    findStopMonitoringArrivals
  );
}

// PATH alerts are free text about the whole system, so they get one panel at the top of the
// PATH tab instead of being matched to station cards.
const pathAlertsPanel = document.querySelector('#path-alerts');
const pathAlertsStateLoaded = storage.get([PATH_ALERTS_COLLAPSED_KEY]).then((values) => {
  const titles = values[PATH_ALERTS_COLLAPSED_KEY];
  if (Array.isArray(titles)) collapsedPathAlertTitles = titles;
}, () => {});

async function refreshPathAlerts() {
  await pathAlertsStateLoaded;
  let alerts = null;
  try {
    const response = await fetchFeedResponse(PATH_ALERTS_URL, 'PATH alerts');
    alerts = findPathAlerts(await response.json());
  } catch {
    // Shown as "unavailable" below; the feed is unofficial, like the arrivals.
  }
  renderPathAlerts(alerts);
}

// The panel can be collapsed to its "N PATH alerts" heading. The titles that were showing
// when it was collapsed are saved, so it stays collapsed next time but opens again when an
// alert the user has not seen appears.
let collapsedPathAlertTitles = null;
let shownPathAlerts = [];
const pathAlertKey = (alert) => alert.title.toLowerCase();

function setPathAlertsCollapsed(collapsed) {
  collapsedPathAlertTitles = collapsed ? shownPathAlerts.map(pathAlertKey) : null;
  if (collapsed) storage.set({ [PATH_ALERTS_COLLAPSED_KEY]: collapsedPathAlertTitles });
  else storage.remove(PATH_ALERTS_COLLAPSED_KEY);
  pathAlertsPanel.classList.toggle('collapsed', collapsed);
  pathAlertsPanel.querySelector('.system-alerts-toggle')?.setAttribute('aria-expanded', String(!collapsed));
}

function renderPathAlerts(alerts) {
  const expandedAlertIds = new Set(
    [...pathAlertsPanel.querySelectorAll('.service-alert[open]')].map((item) => item.dataset.alertId)
  );
  const hadFocus = pathAlertsPanel.querySelector('.system-alerts-toggle') === document.activeElement;
  pathAlertsPanel.replaceChildren();
  pathAlertsPanel.hidden = alerts !== null && !alerts.length;
  shownPathAlerts = alerts || [];
  if (!alerts) {
    pathAlertsPanel.dataset.state = 'error';
    pathAlertsPanel.classList.remove('collapsed');
    pathAlertsPanel.textContent = 'PATH alerts are unavailable right now.';
    return;
  }
  pathAlertsPanel.dataset.state = 'alerts';
  const collapsed = Boolean(collapsedPathAlertTitles)
    && alerts.every((alert) => collapsedPathAlertTitles.includes(pathAlertKey(alert)));
  pathAlertsPanel.classList.toggle('collapsed', collapsed);

  const heading = document.createElement('h2');
  heading.className = 'system-alerts-heading';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'system-alerts-toggle';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-controls', 'path-alerts-list');
  const count = document.createElement('span');
  count.textContent = alerts.length === 1 ? '1 PATH alert' : `${alerts.length} PATH alerts`;
  const chevron = document.createElement('span');
  chevron.className = 'card-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  toggle.append(count, chevron);
  toggle.addEventListener('click', () => {
    setPathAlertsCollapsed(!pathAlertsPanel.classList.contains('collapsed'));
  });
  heading.append(toggle);
  const list = document.createElement('div');
  list.id = 'path-alerts-list';
  list.className = 'system-alerts-list';
  pathAlertsPanel.append(heading, list);
  if (hadFocus) toggle.focus();
  for (const alert of alerts) {
    const details = document.createElement('details');
    details.className = 'service-alert';
    details.dataset.alertId = alert.id;
    details.open = expandedAlertIds.has(alert.id);

    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'service-alert-label';
    label.textContent = alert.title;
    const time = document.createElement('span');
    time.className = 'service-alert-header';
    time.textContent = `Updated ${new Date(alert.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    summary.append(label, time);

    const description = document.createElement('p');
    description.className = 'service-alert-description';
    description.textContent = toPlainText(alert.message)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n') || 'No additional details provided.';
    details.append(summary, description);
    list.append(details);
  }
}

function refreshPath() {
  return Promise.all([
    refreshPathAlerts(),
    refreshView(
      views.path,
      async () => [],
      (_favorite, feedCache) => fetchPathFeed(feedCache),
      () => [],
      (feed, favorite) => findPathArrivals(feed, favorite)
    )
  ]);
}

const refreshers = { subway: refreshSubway, bus: refreshBus, path: refreshPath };

function refreshMode(mode) {
  return refreshers[mode]();
}

function refreshTrackedModes() {
  return Promise.all(Object.keys(views).map((mode) => (
    favoritesByMode[mode].length ? refreshMode(mode) : Promise.resolve()
  )));
}

function showMode(mode) {
  for (const [viewMode, view] of Object.entries(views)) {
    const selected = viewMode === mode;
    view.panel.hidden = !selected;
    view.tab.setAttribute('aria-selected', String(selected));
    view.tab.tabIndex = selected ? 0 : -1;
  }
}

function selectMode(mode) {
  showMode(mode);
  storage.set({ [LAST_MODE_KEY]: mode });
  if (!views[mode].data) {
    loadModeData(mode);
  } else {
    refreshMode(mode);
  }
}

const modeOrder = Object.keys(views);
for (const mode of modeOrder) {
  views[mode].tab.addEventListener('click', () => selectMode(mode));
  views[mode].tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = modeOrder[(modeOrder.indexOf(mode) + step + modeOrder.length) % modeOrder.length];
    views[next].tab.focus();
    selectMode(next);
  });
}
for (const mode of Object.keys(views)) {
  views[mode].addButton.addEventListener('click', () => addFavorite(mode));
}
for (const mode of Object.keys(views)) {
  views[mode].refreshButton.addEventListener('click', () => refreshMode(mode));
}

async function loadFavorites() {
  const storedValues = await storage.get([
    SUBWAY_FAVORITES_KEY,
    BUS_FAVORITES_KEY,
    PATH_FAVORITES_KEY,
    LEGACY_FAVORITES_KEY
  ]);
  const oldFavorites = storedValues[LEGACY_FAVORITES_KEY] || [];
  favoritesByMode.subway = storedValues[SUBWAY_FAVORITES_KEY]
    || oldFavorites.filter((favorite) => !favorite.mode || favorite.mode === 'subway');
  favoritesByMode.bus = storedValues[BUS_FAVORITES_KEY]
    || oldFavorites.filter((favorite) => favorite.mode === 'bus');
  favoritesByMode.path = storedValues[PATH_FAVORITES_KEY] || [];

  storage.set({
    [SUBWAY_FAVORITES_KEY]: favoritesByMode.subway,
    [BUS_FAVORITES_KEY]: favoritesByMode.bus,
    [PATH_FAVORITES_KEY]: favoritesByMode.path
  });
  if (oldFavorites.length) storage.remove(LEGACY_FAVORITES_KEY);

  for (const mode of Object.keys(views)) {
    if (!views[mode].data) continue;
    renderFavorites(mode);
    if (favoritesByMode[mode].length) refreshMode(mode);
  }
}

const dataLoaders = { subway: loadSubwayData, bus: loadBusData, path: loadPathData };

async function loadModeData(mode) {
  const view = views[mode];
  if (loadingModes.has(mode) || view.data) return;
  loadingModes.add(mode);
  view.addButton.disabled = true;
  view.loadStatus.removeAttribute('data-error');
  view.loadStatus.textContent = `Loading ${mode} routes and stops...`;
  try {
    view.data = await dataLoaders[mode]();
    initializeView(mode);
    renderFavorites(mode);
    if (favoritesByMode[mode].length) refreshMode(mode);
    else if (mode === 'path') refreshPathAlerts();
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

// Open on the tab that was showing last time.
storage.get([LAST_MODE_KEY]).then((values) => {
  if (views[values[LAST_MODE_KEY]]) showMode(values[LAST_MODE_KEY]);
}, () => {});

Promise.allSettled([
  loadModeData('subway'),
  loadModeData('bus'),
  loadModeData('path'),
  loadFavorites().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unable to load saved stops.';
    for (const view of Object.values(views)) {
      view.loadStatus.textContent = `Saved stops unavailable: ${message}`;
    }
  })
]);
// Poll only while the page is visible; a phone that was locked or switched away gets fresh
// arrivals as soon as it comes back.
let refreshTimer = window.setInterval(refreshTrackedModes, REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  window.clearInterval(refreshTimer);
  if (document.hidden) return;
  refreshTrackedModes();
  refreshTimer = window.setInterval(refreshTrackedModes, REFRESH_INTERVAL_MS);
});