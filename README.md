# Personal GZW Tac Map mirror

A local mirror of the public [GZW Tac Map](https://gzwtacmap.com/maps/lamang), captured on 24 October 2026. It runs the original browser JavaScript and styles, preserving the map UI rather than approximating it with a new design.

## Install the Windows desktop app

1. [Download GZW Tac Map Setup.exe](https://github.com/kobussteynn/gzw-local-map/releases/latest).
2. Double-click the installer. It installs for your Windows user and creates desktop and Start menu shortcuts.
3. Open **GZW Tac Map**. The map runs in its own desktop window.

No Python, Node.js, browser, account, or terminal is needed. Internet access is needed for map data that has not been downloaded yet. This is an unsigned community application, not an official GZW release.

The desktop app stores notes, saved runs and downloaded map data in its own Windows app-data folder, separate from Opera/Chrome. Use **Map > Open data folder** to find it. Existing browser runs can be exported as JSON and imported using the Runs panel. The app preserves its data through updates and uninstall. The old browser launcher remains available for people who prefer it.

## Build the desktop installer (maintainers)

On Windows x64, install Node.js and Python 3.10 or newer, then run:

```powershell
npm ci
python -m pip install -r desktop/requirements-build.txt
npm run build:win
```

The installer is generated under `dist/`. Electron wraps the existing map; PyInstaller bundles the local Python service so end users do not install Python. The desktop service listens only on 127.0.0.1:4174 and stops when the desktop app closes. It has a separate persistent profile from the browser app on port 4173. `npm run desktop` starts the desktop app from source using Python.

## Run from source in a browser

Requires Python 3.10 or newer. No package installation, API key, or build step is needed.

```powershell
python server.py
```

Open **http://localhost:4173/maps/lamang#m=18.34/7789.91/6405.92**. This uses the exact starting view from the supplied link. The homepage is at http://localhost:4173/.

Alternatively, run `./start.ps1` or `npm start`. Keep that terminal running. Stop with Ctrl+C. To choose another port: `python server.py --port 8080`.

### Desktop shortcut / browser choice

Double-click **GZW Tac Map** on the Windows desktop. `open-map.ps1` starts the local server in the background if needed, waits until it is ready, and opens the map in your chosen browser. On the first launch, a dialog asks you to choose the Windows default browser or an installed browser, including Opera GX, Opera, Chrome, Edge, Firefox, Brave or Vivaldi. The choice is remembered locally in `cache/browser-preference.json` (excluded from Git). This does not change the Windows default browser. Use the **GZW Tac Map - Choose Browser** desktop shortcut or run `powershell -NoProfile -ExecutionPolicy Bypass -File open-map.ps1 -ChooseBrowser` to change it later. Cancelling the dialog does not start the map. No terminal needs to stay open. The launcher reuses an existing healthy server. Errors appear in a small message box, with background server logs in `cache/desktop-server-output.log` and `cache/desktop-server-error.log`.

To recreate the shortcut after moving the project, run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-desktop-shortcut.ps1`. This uses the Windows Desktop location, including redirected OneDrive desktops. `powershell -NoProfile -ExecutionPolicy Bypass -File open-map.ps1 -CheckOnly` checks server readiness and the saved browser preference without opening a browser or showing the picker.

## What is included

- The original public Svelte browser client, styles, icons, responsive layouts, and navigation.
- Lamang and YBL-1 public map routes, tasks, keys, categories, marker details, archive, and settings, fetched on demand.
- Real terrain tiles fetched directly from the original CDN, through the local server.
- Public icon and marker API responses, fetched directly from the original server.
- Local disk caching, including fallback to cached responses if the original service is unavailable.
- Original browser-local progress profiles and task tracking. Localhost has its own browser storage, separate from the original website.
- Readable exports in `data/`: 5,254 Lamang map markers across 55 groups, 23 YBL-1 markers, task-marker groups, icons, task page data, and key page data. `data/sources.json` records the exact public data URLs.

The initial cache includes 143 core public page/data/API requests. Individual marker pages, images, and terrain tiles are downloaded as visited. This is an operational public-site mirror, not a copy of the private server source, database administration, or account backend. Authentication, server-side editing, and submissions are not implemented by the local server. Outbound requests through the mirror are read-only; analytics are disabled.

## Runs planner

Click **Runs** in the left navigation. The **Plan** tab lets you:

- Search real locations such as Golf 2, hangars, terminal buildings, and doors, then add them as ordered route stops. Reorder stops with the arrow buttons.
- Add custom stops directly on the map. Yellow lines connect the stops in order.
- Use **Draw route**, then drag on the map to draw freehand. Each drawing has its own note field beneath the route stops. Native draw colors, dashed lines, Undo and Clear still work.
- Place **Note** pins and **Mortar target** pins. Targets have a name, note, strike phase and adjustable planning radius. Select a faction mortar overlay to compare a target's distance with the original range rings. These are planning markers, not live game commands or an ammunition-specific firing solution.
- Select doors you intend to enter, choose extra keys, and write gear and reminder lists. Nearby doors are suggested within 100 m of your route. Key associations show whether they came from API links, matching door names, or your manual selection. Missing associations remain unresolved until selected manually.
- Review known boss spawn locations within a chosen distance of the route. Proximity includes the segments between route stops and freehand drawings. These are known map locations, not live boss detection.

Name the plan and choose **Save run** to add it to **Saved runs**. Later edits to a saved run are kept automatically. Open a saved run to restore the map view, version, route drawings, notes, mortar overlay and targets, and read its **Briefing**. The briefing contains a packing checklist, keys, planned strikes, ordered route notes, selected doors and nearby bosses. Click a door pin for its key reminder. Checklist state persists locally and can be reset for the next raid.

The library includes a **Load Golf 2 example** action based on the requested airfield scenario. It creates an editable draft; change the faction, equipment and notes to suit your run.

Plans stay in this browser's local storage under `gzw.runs.v1`. They are not uploaded to the original site and are separate from the original site's progress profiles. Export JSON for backups or transfer to another browser; import validates the run format. Clearing browser storage removes locally stored plans. Delete has an Undo action until another deletion or page reload.

Implementation: `local/runs.js`, `local/planner-core.mjs`, and `local/runs.css`. The server injects these local assets and adds narrow map/drawing hooks while serving the original client. Captured upstream bundles remain unchanged. The bridge checks its expected anchors and requires maintenance if the original map client is replaced. `/__mirror/planner-data?map=lamang` supplies public map/key references using the same cached APIs and exported-data fallback.

## Personal map notes

Right-click anywhere on the map and choose **Notes**, immediately below **Share this location**. Enter a title and note, then save. A prominent blue dot marks the location, with **Note** written beneath it in the style of a point-of-interest label. The marker has a 46 px click target and supports Enter/Space from the keyboard.

Click a blue dot to read, edit or delete its note. The **Notes** navigation section lists personal notes on the current map and provides Locate and Read / edit actions. Delete can be undone from that section until the next deletion or reload.

Personal map notes are stored in this browser under `gzw.notes.v1`, remain visible when switching runs, and are not sent to the original website. Run-specific note pins use the same blue-dot appearance and editor, but continue to save with their run. Browser checks verified the context menu placement, creating a note, reopening its editor and persistence after reload.

## Location name filters

Use the magnifying-glass **Location filters** navigation button, or **Locations** in the map toolbar. Search names such as **Trashed Campsite**, **Campsite**, **Hidden Poppy Fields** or **LAF Checkpoint**. Typing previews matching game markers immediately; **+ Add** or Enter keeps a name as a selected filter. Add more names to show their combined locations. A **Campsite** selection matches normal campsites exactly; adding **Trashed Campsite** includes those too. Partial phrases and common plural forms work in the search box. Search **LZ**, **LZs**, **landing zones** or a specific name such as **Golf 2**. **All landing zones** and **All loot** can be selected alongside individual locations or container names. Loot includes known container, key-spawn and item categories from public marker metadata; it does not predict container contents.

Remove a selected chip to drop that name, or use **Clear** to restore the native category visibility and zoom limits. **Fit matches** shows the matching locations across the map. Name filters temporarily override game-marker category visibility and normal label zoom thresholds; native floor/faction eligibility is still respected. Unmatched game markers are removed from native sources while filtering, so they are also excluded from map hit detection. Personal notes and planned routes remain visible.

Selections and the search preview are remembered per map in browser local storage under `gzw.location-filters.v1.<map-name>`. The name catalog comes from the current public map data and the actual native marker sources. Locations are not inferred from map imagery, and the filter does not identify container contents.

Implementation: `local/location-filter.js` and `local/location-filter-core.mjs`. Automated tests cover exact-name combinations, search aliases, restoring native layers, late-loaded markers, and eligibility. Browser checks cover campsite combinations, poppy-field/checkpoint search, empty results, Clear and restored selections after reload.

## Mission selection

Open **Tasks**, choose your faction if asked, and select **Show on map** on each mission you want to do. Several missions can be selected together. **Hide from map** removes one mission. **Fit shown missions** frames their objectives. Completion and progress profiles retain the original task behavior. Tasks without mapped objectives cannot display pins. Location and loot filters leave native task layers untouched, so selected missions stay visible while filtering loot. The previous task-name entries in Locations have been removed; mission selection is controlled only from Tasks.

## Public data sources

| Local route | Original source |
| --- | --- |
| `/api/icons` | `https://gzwtacmap.com/api/icons` |
| `/_app/remote/1g4p39w/fetchMapMarkers?payload=…` | Same route on `https://gzwtacmap.com` |
| `/maps/…/__data.json` | Public SvelteKit page-data endpoints on the original site |
| `/__upstream/cdn/…` | `https://cdn.gzwtacmap.com/…` |
| `/__upstream/static/…` | `https://static.gzwtacmap.com/…` |

All API parameters and binary assets are preserved. Site links are rewritten to stay on localhost. External guide/community links remain external. Requests use public access only and do not forward your browser cookies to the original site.

## Cache and data exports

Downloaded resources live in `cache/responses.sqlite3`. The public browser assets live in `snapshot/`. Back up both folders to preserve the downloaded copy. Dynamic responses are refreshed after one hour; immutable assets and terrain tiles are retained. The captured client stays pinned to its downloaded version.

```powershell
# Cache core public pages and their navigation data again
python tools/sync.py

# Optional: also cache the thousands of individual marker detail pages
python tools/sync.py --all-pages

# Regenerate readable JSON exports from the locally cached API responses
python tools/export_data.py

# Serve only previously downloaded resources, with no network fallback
python server.py --offline

# Check cache size and resource count while the server runs
curl.exe http://localhost:4173/__mirror/status
```

Offline mode requires each requested resource and query variant to have been cached first. A full offline download of every tile, historical version, media file, and page is **not** included. The original service remains necessary for resources you have not visited and for live data updates. Changes to the upstream endpoints or schema can require updating this mirror.

## Verification

```powershell
python -m unittest discover -s tests -v
node --test tests/planner.test.mjs
```

Tests cover URL rewriting, byte-for-byte image preservation, restricted asset routing, separate API query caches, offline behavior, and analytics removal. Browser checks verified actual terrain and marker rendering, task navigation, task search, task details, and progress persistence across reloads.

Planner tests cover route-segment proximity, key association and deduplication, saved-plan round trips, import validation, offline reference loading, and map bridge compatibility. Browser checks verified native freehand drawing capture, drawing notes, map-note placement, save/reopen/reload, the Golf 2 briefing, required keys, and mortar range references.
