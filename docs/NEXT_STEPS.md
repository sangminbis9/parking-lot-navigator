# Next Steps

Last updated: 2026-04-29

## Current Status

- Branch: `master`
- Last pushed commit before this session: `9b8d759 Replace realtime clusters with overlap pins`
- Realtime parking and festival/event layers use overlap-collapsed pins.
- iOS build number is 74.

## Completed This Session

Festival/event map display and list refinement on the iOS Kakao map.

Touched files:

- `ios-app/Features/Map/KakaoParkingMapView.swift`
- `ios-app/Features/Map/MapHomeView.swift`
- `ios-app/Features/Map/MapHomeViewModel.swift`
- `ios-app/Core/Models/ParkingLot.swift`
- `ios-app/Core/Networking/APIClient.swift`
- `ios-app/Tests/ParkingLotNavigatorTests.swift`
- `ios-app/project.yml`
- `docs/PROJECT_STATE.md`
- `docs/DECISIONS.md`
- `docs/NEXT_STEPS.md`

Implemented behavior:

- Festival/event numeric clusters were removed.
- Festival/event layers now render actual pins.
- Festival/event pins that overlap in screen space collapse to one representative pin while zoomed out.
- Overlapping festival/event pins separate with small offsets after zooming in.
- Festival/event title labels only show at deep zoom.
- Realtime parking numeric clusters were removed.
- Realtime parking pins that overlap in screen space collapse to one representative pin while zoomed out.
- Overlapping realtime parking pins separate with small offsets after zooming in.
- The iOS app loads realtime parking lots directly and no longer requests realtime cluster data for map rendering.
- The map bottom panel now has `Parking` and `Event/Festival` tabs.
- The event/festival tab shows a unified list with thumbnail images, type/status badges, venue/address text, date, and distance.
- The event/festival list supports local search and distance/date/name sorting.
- Event/festival list distance values and distance sorting use the user's current location when available.
- Tapping a list row opens the existing detail sheet with a main image area.
- The detail sheet map action stays in app, focuses the Kakao map on the selected item, sets it as the destination, loads nearby parking, and enables/loads realtime parking.

Validation:

- Run `git diff --check` before committing.
- Run local iOS tests/build if Xcode tooling is available; otherwise rely on CI/Codemagic for full iOS validation.
- GitHub Actions now includes `iOS Simulator Build`, which runs backend tests, generates the Xcode project, builds the iOS app for simulator, and runs iOS unit tests.

## After Worker Deploys

- If realtime provider changes are deployed, run or wait for realtime cache sync.
- Verify `/parking/realtime` and `/parking/realtime/clusters` behavior from the production Worker.
- In app, verify realtime toggle after sync.

## Backlog

- Final user flow to validate first: user selects a place -> map shows recommended parking -> user toggles lodging -> app shows nearby lodging pins and a unified discovery list -> lodging detail shows official/public lodging metadata -> "map view" recenters on that lodging and refreshes parking/realtime context.
- Configure `PUBLIC_DATA_SERVICE_KEY` and `KAKAO_REST_API_KEY` in Worker secrets, then verify `/discover/lodging` against production.
- Add an iOS date/guest selector only after an OTA booking-price provider is approved.
- Add lodging price freshness and disclosure text before enabling any paid booking-price provider.
- Get exact Seongdong IoT Seoul Open Data service name/field map if the provider still returns no rows.
- Add more regional realtime providers as approvals arrive.
- Improve provider health/debug visibility without exposing secrets.
- Add a small admin preview endpoint for individual providers if future provider debugging remains slow.

## New Session Prompt

Use this at the start of a new Codex session:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md. Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
