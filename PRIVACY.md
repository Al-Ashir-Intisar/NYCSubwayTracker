# Privacy Policy — NYC Transit Tracker

_Last updated: October 27, 2026_

NYC Transit Tracker ("the extension") shows realtime arrival times and service alerts for NYC subway and bus stops, and realtime PATH train arrivals, that you choose. This policy explains what data the extension handles.

## Summary

- The extension does **not** collect, sell or share any personal information.
- There are no accounts, analytics, ads or tracking.
- Your saved stops stay in your own browser.

## Data stored on your device

When you save a station/stop and route (or, for PATH, a station and direction), the extension stores that selection (for example, "Times Sq-42 St, 1 train" or "Hoboken, To New York") using Chrome's `storage.local` API. This data:

- stays on your computer and is never sent to the developer or any third party;
- is used only to show arrivals for the stops you saved;
- is deleted when you remove a saved stop or uninstall the extension.

## Network requests

To show live arrivals and alerts, the extension downloads public transit feeds directly from the Metropolitan Transportation Authority (MTA) and the Port Authority of New York and New Jersey (PANYNJ):

- `api-endpoint.mta.info` (subway arrivals and alerts)
- `gtfsrt.prod.obanyc.com` (MTA Bus Time arrivals and alerts)
- `www.panynj.gov` (PATH train arrivals, from the public data that powers the PATH schedule page on the Port Authority's website; it is not an official, supported API and may change or stop working)

These requests download the full public feed. They do **not** include your saved stops, location or any personal identifier. As with any web request, these agencies' servers can see standard connection details such as your IP address. See the [MTA privacy policy](https://new.mta.info/privacy-policy) and the Port Authority's website for how they handle this.

The extension does not contact any other server, including any server run by the developer.

## Data we do not collect

The extension does not collect or access your name, email, location, browsing history, web page contents, keystrokes, financial information, health information or authentication credentials.

## Permissions

- **storage**: saves your selected stops on your device.
- **Host access to the MTA domains and the PATH data path on `www.panynj.gov` above**: fetches realtime arrival and alert feeds. Access to `www.panynj.gov` is limited to `/bin/portauthority/`.

## Changes

If this policy changes, the updated version will be posted at this URL with a new "Last updated" date.

## Contact

Questions or concerns: open an issue at <https://github.com/Al-Ashir-Intisar/NYCSubwayTracker/issues>.
