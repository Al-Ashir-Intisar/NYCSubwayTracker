# NYCSubwayTracker

A Chrome extension for tracking realtime arrival predictions for selected NYC subway routes and stations.

## Run the extension

1. Install dependencies with `npm install`.
2. Build the realtime feed decoder with `npm run build`.
3. In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select this repository directory.
4. Choose a station and route in the popup, then add it to your tracked stops.

## Features

- Search MTA stations and subway routes, then save the station-and-route combinations you want to track.
- View live arrival predictions grouped by direction and destination.
- See active service alerts that match each saved station and route. Alerted cards are highlighted; expand an alert to read its description.
- Refresh arrivals and service alerts every 15 seconds while the popup is open. Saved stops are stored in your browser.

The extension reads public MTA realtime feed URLs from `gtfs_subway/realtime_feed_apis.txt` and service alert feed URLs from `gtfs_subway/service_alert_feeds.txt`. Station and platform matching uses `gtfs_subway/stops.txt`.

## How It Looks

![NYC Subway Tracker extension popup showing tracked stations, arrival predictions, and a service alert](./ExtensionUI.png)
