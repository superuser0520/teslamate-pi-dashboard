# Design QA

## SooLew iOS Theme Deployment

- Verified the dashboard renders with the new `SooLew` brand in the top bar and document title.
- Verified the default `Full Black` theme against mock TeslaMate data at desktop and mobile viewport sizes.
- Verified the `White` theme renders clean card surfaces, readable text, map tiles, charts, temperature, and elevation values.
- Verified Settings exposes only the selected theme choices: `Full Black` and `White`.
- Verified OpenStreetMap/Leaflet maps initialize with vehicle location data.

Checks run:

```sh
node --check dashboard/public/app.js
node --check dashboard/server.js
```
