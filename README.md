# NYC Transit Tracker

A Chrome extension for tracking realtime arrival predictions for selected NYC subway and bus routes and stops, and PATH train stations.

## Run the extension

1. Install dependencies with `npm install`.
2. Add your MTA Bus Time API key to the ignored `.dev.vars` file as `MTA_BUS_API_KEY=your-key` (the extension ID is no longer needed).
3. Build the extension with `npm run build`.
4. In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select this repository directory.
5. Use the separate Subway, Bus and PATH tabs to choose a station/stop and route (or, for PATH, a direction), then add it to that mode's tracked list.

## Features

- Use separate Subway and Bus tabs, each with its own stop search, route search, saved stops, and arrival results.
- Search subway stations or bus stops and routes with relevance-ranked fuzzy matching, then save the combinations you want to track.
- View realtime arrival predictions grouped by direction and destination.
- See active service alerts matching each saved route and station/stop. Alerted cards are highlighted; expand an alert to read its description.
- Track PATH stations by direction (To New York, To New Jersey or both). Arrivals are grouped by destination and colored by line. PATH alerts are not available.
- Refresh arrivals and service alerts every 30 seconds while the popup is open. Saved stops are stored in your browser.

### PATH data

The Port Authority publishes no official realtime PATH API. The PATH tab reads `https://www.panynj.gov/bin/portauthority/ridepath.json`, the JSON that powers the schedule page on panynj.gov. It needs no key, but it is unofficial and could change or disappear without notice; the tab shows a "may be down" message when the feed fails. The 13 stations and their codes live in `src/path.js`.

The extension uses subway feeds from `gtfs_subway/realtime_feed_apis.txt` and `gtfs_subway/service_alert_feeds.txt`. Bus route/stop lookup tables in `gtfs_bus/` are compiled from the six public MTA bus GTFS feeds. Bus realtime requests go directly to the MTA Bus Time API.

### Bus API key

The build reads `MTA_BUS_API_KEY` from the ignored local `.dev.vars` file and writes the bus feed URLs to ignored `dist/bus-config.js`. The key is not committed, but it is visible to anyone who can inspect or copy a built extension. Do not commit or share the generated `dist/` directory if you want to keep using this key privately. Rebuild after changing the key.

Only transit modes with saved station/route combinations are refreshed. If you track subway stops only, the extension requests subway feeds only; bus feeds are fetched only when bus stops are tracked. Refresh runs every 30 seconds while the popup is open and at least one stop is tracked. MTA bus static GTFS data is published quarterly; refresh `gtfs_bus/routes.txt` and `gtfs_bus/stops.txt` from the six official feeds when MTA updates those schedules.

## How It Looks

![NYC Transit Tracker extension popup showing tracked stations, arrival predictions, and a service alert](./ExtensionUI.png)
