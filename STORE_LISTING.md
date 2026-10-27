# Chrome Web Store dashboard entries

Copy these values into the Developer Dashboard for the extension.

## Store listing tab

- **Official URL / Homepage URL:** https://github.com/Al-Ashir-Intisar/NYCSubwayTracker
- **Support URL:** https://github.com/Al-Ashir-Intisar/NYCSubwayTracker/issues

## Privacy practices tab

### Single purpose

> Shows realtime arrival predictions and service alerts for NYC subway and bus stops that the user chooses to track.

### Permission justifications

**storage**

> Saves the user's selected subway/bus stops and routes locally with chrome.storage.local so they persist between popup openings. Nothing is sent off the device.

**Host permissions (https://api-endpoint.mta.info/*, https://gtfsrt.prod.obanyc.com/*)**

> Fetches public MTA GTFS-realtime feeds (subway and MTA Bus Time) to display live arrival times and service alerts. Requests contain no user data. No other hosts are accessed.

**Remote code**

> No, I am not using remote code. All JavaScript is bundled in the package; network requests only download protobuf transit data.

### Data usage

Under "What user data do you plan to collect from users now or in the future?": **leave every box unchecked.** The extension does not collect any of the listed categories (saved stops never leave the device, so they are not "collected" under Chrome Web Store policy).

Check all three certifications:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

> https://github.com/Al-Ashir-Intisar/NYCSubwayTracker/blob/main/PRIVACY.md
