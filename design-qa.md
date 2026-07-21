# Design QA

## SooLew iOS Theme Deployment

- Verified the dashboard renders with the new `SooLew` brand in the top bar and document title.
- Verified the default `Full Black` theme against mock TeslaMate data at desktop and mobile viewport sizes.
- Verified the `White` theme renders clean card surfaces, readable text, map tiles, charts, temperature, and elevation values.
- Verified Settings exposes only the selected theme choices: `Full Black` and `White`.
- Verified OpenStreetMap/Leaflet maps initialize with vehicle location data.
- Reworked the Overview screen to match the selected iOS mockup more closely: compact battery/range hero, car visual placement, two-column insight cards, state-of-charge card, and bottom tab labels.
- Verified the revised Overview at 390 x 844 with no horizontal scroll and a fixed bottom tab bar.
- Rebuilt the Overview around generated assets: white Model 3 hero photos for light/dark themes, generated iOS-style PNG icons, and exact `JYJ602` plate text in the UI.
- Verified desktop Overview expands into a two-column cockpit layout and the generated image/icon assets load successfully.

Final result: passed.

Checks run:

```sh
node --check dashboard/public/app.js
node --check dashboard/server.js
```
