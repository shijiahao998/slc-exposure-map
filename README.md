# Salt Lake County Facility Map

A static GitHub Pages map. Click a location, then choose **0.25 / 0.5 / 1 / 2 mi** to highlight and count mapped Sensitive & Critical Facilities and Emergency-Response Resources.

## Publish

Create an empty public GitHub repository named `slc-exposure-map`. Push this directory to its `main` branch. In **Settings → Pages → Build and deployment**, select **GitHub Actions**, then run **Deploy static map to GitHub Pages** from Actions if needed. The workflow publishes only `web/`; no build step, backend or secrets are required. Site address: `https://YOUR_USERNAME.github.io/slc-exposure-map/`.

## Local preview

From this directory, run `python -m http.server 8080 --directory web`, then open `http://localhost:8080/`. The server only serves static files; no application API is needed.

## Contents and behavior

- Local MapLibre runtime and licenses; static US/Utah/county basemap, facility points, building-height lookup, parcel and building vector tiles.
- Optional historical USGS imagery is requested directly from the provider when enabled. Other layers are served from this repository. Land Use begins at zoom 9; building detail begins at zoom 12.
- Distance is spherical great-circle distance to mapped points, with 1 mile = 1,609.344 metres. Counts cover the archived county dataset, even when a radius extends outside it. Map visibility switches do not change counts.
- Co-located fire/EMS records within 30 m share one location and retain overlapping roles. Sensitive points with coordinates rounded to five decimal places share one marker. These display rules are inherited from the local map.
- Blue 3D buildings use reported OSM height, green uses floors × 3 m, and optional tan buildings show an illustrative 6 m for unknown height.
- The basemap is always enabled. Static transit routes and stops/stations have independent layer switches; Dynamic Exposure remains omitted. Click a facility, parcel, route or stop to inspect stored attributes. A single click selects points before routes before parcels, and also updates the area when Radius Analysis is enabled. Land Use displays existing parcel classifications only. There are no live feeds, backend calls, population calculations, land-use percentage calculations or processing tools. Existing county GeoJSON and classified parcel tiles are copied unchanged from the local web assets; source attributes in those files do not enable analytical calculations.

## Add a static candidate-area layer

Place the precomputed file at `web/data/candidate-areas.geojson` and add an entry to `web/static-layers.js` using its commented example. The map loads the GeoJSON and adds a visibility switch. Paths are relative, including under the GitHub Pages repository subpath.

## Sources

See [public attribution](web/attribution.html) for retained OSM/ODbL, UGRC/CC BY, UTA static GTFS, Census ACS, USGS imagery and MapLibre notices. The map is an archived facility inventory, not an emergency dispatch or current-availability service. Data layers retain their source licenses; no blanket project license is assigned to third-party data.
