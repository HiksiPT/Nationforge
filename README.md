# Nationforge

A browser 3D country-building and nation-management game on **five real islands**, with terrain from real elevation
models and coastlines from OpenStreetMap. Built with TypeScript, React, three.js (react-three-fiber) and Vite. It runs
entirely in the browser: no server, no paid APIs, saves in IndexedDB.

| Island | Country | Real area | Highest point (DEM) | Gameplay scale (horizontal / vertical) | Difficulty |
|---|---|---|---|---|---|
| Shuna Island | Slate Islands, Scotland | 4.5 km² | 88 m | ×1.8 / ×1.9 | remoteness, gales, little flat land |
| Makri Island | Echinades, Greece | 1.0 km² | 120 m | ×2.0 / ×2.0 | no fresh water, seasonal tourism, Natura 2000 |
| Lastovo | Dubrovnik-Neretva, Croatia | 40.7 km² | 413 m | ×0.7 / ×0.75 | buildable land, transport, housing affordability |
| Isla Guafo | Los Lagos, Chile | 190 km² | 352 m (surface model) | ×1.0 / ×1.0 | logistics, weather, terrain, conservation |
| Mo'orea | French Polynesia | 133 km² | 1181 m | ×0.7 / ×0.7 | flat land, fresh water, cyclones, reef, land rights |

Horizontal and vertical scale are separate but kept within 10% of each other, so slopes and cliffs are not distorted.
Economic numbers are never scaled with map size. All scenarios are fictional development stories; Guafo is framed as a
conservation-first research settlement and Mo'orea as a community-led authority that cannot evict anyone.

## Playing

The core loop: inspect the real terrain → compare port sites in the **Port planner** (shelter from the prevailing swell,
depth, shore slope, flat land, cost, environmental sensitivity) → build a port and add breakwaters, dredging, quays,
customs, road/rail and utility links → build roads (A* routing within each road class's grade limit) → place and zone
buildings (preview with cost breakdown, suitability, slope/road/power/water checks, confirm or cancel, funds deducted,
construction progress slowed by weather, activation on completion) → residents migrate when there are homes, jobs,
wages, utilities and services → the monthly economy updates GDP, wages, rents, inflation, unemployment, trade, FDI,
taxes, debt and interest, with plain-language explanations of what changed → set policy, answer events, trade and
negotiate with generated fictional countries, balance regions, research technology, survive disasters, chase
objectives, then keep playing open-ended.

**Controls (map):** drag to pan, right-drag to rotate/tilt, wheel to zoom, WASD/arrows pan, Q/E rotate, Z/X zoom,
Space pause, 1–4 speed, R rotate a building, Esc or right-click cancel, Ctrl+S save. National / regional / city views
are on the left toolbar; 🚶 walks in first person (WASD, Shift run, Space jump, Esc releases the mouse, M returns to
the map).

## Setup

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # vitest: economic formulas, simulation, saves, all five terrain packages
npm run build      # type-check + production build into dist/
```

The production build uses a relative base (`base: './'`), so `dist/` works from any sub-path, e.g.
`https://<user>.github.io/<repo>/`.

### Deploying to GitHub Pages

1. Push the project to a GitHub repository (branch `main`).
2. In the repository: **Settings → Pages → Source: GitHub Actions**. (With the default "Deploy from a branch" Pages
   serves the raw source and the game never loads.)
3. Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm test`, `npm run build`, then publishes
   `dist/`.

### Rebuilding the terrain data (optional)

The packaged data in `public/data/<id>/` is committed; you only need this to change bounds or sources.

```bash
python -m pip install numpy pillow tifffile imagecodecs
python -I tools/build_terrain.py            # all islands (or: shuna makri lastovo guafo moorea)
python -I tools/make_fallbacks.py           # compact outlines for the fallback terrain
```

Downloads are cached in `data-raw/` (git-ignored). Overpass is flaky; the script retries across mirrors with a
non-browser User-Agent. Each package has `terrain.bin` (int16, real metres × 4, row 0 = north), `mask.bin` (land class
and flags: territory, foreign land, protected area, woodland, reef/sensitive shallows, beach, community land,
approximated cell), `meta.json` (sizes, scales, sources, statistics, approximations, OSM roads/places/buildings/outline)
and `preview.png` (used by the menu and minimap).

## Data sources and licences

| Data | Source | Licence / attribution |
|---|---|---|
| Land elevation | Copernicus DEM GLO-30 (DSM), AWS Open Data `copernicus-dem-30m` | Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Free use with attribution. |
| Bathymetry (Shuna, Makri, Lastovo) | EMODnet Bathymetry DTM (~115 m), WCS | CC BY 4.0, © EMODnet Bathymetry Consortium |
| Bathymetry (Guafo, Mo'orea) | AWS Terrain Tiles (terrarium), ocean from ETOPO1 / GEBCO (~1.8 km) | Open data; ETOPO1 (NOAA NCEI), GEBCO Compilation Group; Terrain Tiles by Mapzen / Linux Foundation |
| Coastlines, roads, places, buildings, protected areas, woodland, beaches | OpenStreetMap via Overpass | © OpenStreetMap contributors, ODbL 1.0 |

The in-game **Geo data** panel (🛰 on the toolbar) shows, per island: DEM source and tiles, native and game
resolution, horizontal scale, vertical scale and slope exaggeration, missing and approximated data percentages, the
bathymetry method, attribution and licences, plus live renderer statistics.

## Approximations and known limitations

- **Surface model.** Copernicus GLO-30 is a DSM: forest canopy and buildings are part of the land height (Guafo's
  forested heights read about 10–25 m high).
- **Bathymetry is partly modelled and labelled as such.** Within two grid cells of the coast (EMODnet islands) or
  within ~3 km (Guafo, Mo'orea) a shelf profile is blended into the real data. Mo'orea's lagoon and reef crest are a
  modelled profile, and its enclosed bays (Cook's and ʻŌpūnohu) are modelled as deep drowned valleys (to 45 m). No
  island has surveyed harbour-scale depths.
- **Resolution.** The terrain grid is 10–45 m per cell (finest on Makri, coarsest on Guafo). Coastlines and harbours
  are recognisable at island scale; first-person close-ups show the coarse grid.
- **Fallback terrain.** If a terrain package fails to load, the game builds a smooth dome inside the real OSM outline
  and labels it clearly in the UI and Geo panel. Verified in the production build by blocking `terrain.bin`;
  neighbouring islands (e.g. Luing next to Shuna) are not part of the fallback.
- **Buildings do not reshape the terrain.** They sit on terraced foundations instead.
- **Roads cannot bridge water** and are routed on the terrain grid, so very short roads snap to cells.
- **Economy.** A deliberately compact model (documented in `src/sim/economy.ts` and `src/sim/engine.ts`): one labour
  market per island, uniform staffing, monthly trade allocation limited by port tonnage. Starting economies include a
  "legacy" share of jobs, power and water for the people already living there. Numbers are tuned for play, not
  forecasting.
- **Fictional world.** Foreign countries, events and investors are generated; nothing represents real governments,
  companies or plans.
- **Visual-only systems.** The day/night cycle is visual (its speed is a setting); ships near ports are decorative;
  audio is synthesised with Web Audio.
- **Performance.** Guafo and Mo'orea are the heaviest maps (dense rainforest/jungle and thousands of OSM roads); use
  the Medium or Low preset on integrated GPUs. Graphics settings change pixel ratio, shadow map size, terrain mesh
  resolution, vegetation count, fog/view distance, weather particles and anti-aliasing.

## Project layout

```
tools/            terrain packager (Python) and fallback outline exporter
public/data/      packaged terrain per island
src/data/         data-driven catalogue: buildings, ports, resources, research, scenarios, styles
src/geo/          Terrain class (sampling, slope, coast distance, fallback)
src/sim/          deterministic simulation: world actions, placement, ports, roads, engine, economy, events,
                  diplomacy, weather, calendar, new game
src/save/         versioned save envelope with checksum, migrations, IndexedDB slots with backups
src/render/       three.js scene: terrain LOD, water, sky, buildings (instanced procedural models), roads,
                  vegetation, weather, camera, first person, tools, overlays
src/ui/           React HUD, menus and management panels
tests/            vitest suites
```

The simulation advances in fixed one-day steps converted from real time with an accumulator, draws all randomness
from a seeded generator stored in the save, and is verified to replay identically from the same seed and from a
reloaded save.
