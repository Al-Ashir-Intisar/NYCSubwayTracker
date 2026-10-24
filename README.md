# NYCSubwayTracker

A Chrome extension for tracking realtime arrival predictions for selected NYC subway routes and stations.

## Run the extension

1. Install dependencies with `npm install`.
2. Build the realtime feed decoder with `npm run build`.
3. In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select this repository directory.
4. Choose a station and route in the popup, then add it to your tracked stops.

The extension reads public MTA realtime feed URLs from `gtfs_subway/realtime_feed_apis.txt` and matches realtime stop IDs with `gtfs_subway/stops.txt`. Relevant active service alerts from `gtfs_subway/service_alert_feeds.txt` appear on matching tracked station and route cards; expand an alert to read its description. Arrivals and service alerts refresh every 15 seconds while the popup is open. Your tracked station and route pairs are saved in this browser.
