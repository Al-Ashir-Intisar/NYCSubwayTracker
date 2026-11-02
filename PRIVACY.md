# Privacy Policy — NYC Transit Tracker

_Last updated: November 2, 2026_

NYC Transit Tracker shows realtime arrival times and service alerts for the NYC subway and bus stops, and the PATH train stations, that you choose. It is available as:

- a **Chrome extension** ("the extension"), and
- a **web app** at <https://nyc-transit-tracker.iamintisar45.workers.dev/> ("the web app").

This policy explains what data each version handles.

## Summary

- Neither version collects, sells or shares personal information.
- There are no accounts, analytics, ads, cookies or tracking.
- Your saved stops stay on your own device.

## Data stored on your device

When you save a station or stop and a route (or, for PATH, a station and direction), that selection, for example "Times Sq-42 St, 1 train" or "Hoboken, To New York", is stored on your device:

- the **extension** uses Chrome's `storage.local`;
- the **web app** uses your browser's local storage for that website, and also keeps a copy of the app's own files (pages, styles, and station and route lists) so it opens quickly and works on a weak signal.

Your saved stops are never sent to the developer or any third party, are used only to show arrivals for the stops you saved, and are deleted when you remove a stop, uninstall the extension, or clear the website's data in your browser.

## Network requests

To show live arrivals and alerts, both versions download public transit data from the Metropolitan Transportation Authority (MTA) and the Port Authority of New York and New Jersey (PANYNJ):

- `api-endpoint.mta.info`: subway arrivals and alerts
- `gtfsrt.prod.obanyc.com`: MTA Bus Time arrivals and alerts
- `bustime.mta.info`: MTA Bus Time arrivals for a single stop (web app only)
- `www.panynj.gov`: PATH train arrivals, from the public data behind the PATH schedule page on the Port Authority's website. It is not an official, supported data feed and may change or stop working.

### The extension

The extension downloads these feeds **directly** from the agencies. The requests download whole citywide feeds and do not include your saved stops, location or any personal identifier. As with any web request, the agencies' servers can see standard connection details such as your IP address. The extension does not contact any other server, including any server run by the developer.

### The web app

Web browsers don't allow websites to download these feeds directly, so the web app gets them through a small relay run by the developer on [Cloudflare Workers](https://www.cloudflare.com/). The relay fetches the feed from the agency and passes it back to you. As a result:

- The agencies see requests coming from Cloudflare, not from your device.
- For **bus arrivals**, the request includes the stop and route you are viewing (for example, "stop 308209, B63"), so the relay and MTA Bus Time can see which stop is being looked up. Subway, alert and PATH requests download whole feeds and do not include your stops.
- Like any website host, Cloudflare processes standard request details such as your IP address, browser type and the address requested. The developer can see short-lived operational logs of these requests in Cloudflare's dashboard and uses them only to keep the service running and fix problems. They are not combined with other data, used to identify you, or shared. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

See the [MTA privacy policy](https://new.mta.info/privacy-policy) and the Port Authority's website for how the agencies handle requests.

## Data we do not collect

Neither version collects or accesses your name, email, location, browsing history, web page contents, keystrokes, financial information, health information or authentication credentials.

## Extension permissions

- **storage**: saves your selected stops on your device.
- **Host access to the MTA domains and the PATH data path on `www.panynj.gov` listed above**: fetches realtime arrival and alert feeds. Access to `www.panynj.gov` is limited to `/bin/portauthority/`.

## Changes

If this policy changes, the updated version will be posted at this URL with a new "Last updated" date.

## Contact

Questions or concerns: open an issue at <https://github.com/Al-Ashir-Intisar/NYCSubwayTracker/issues>.
