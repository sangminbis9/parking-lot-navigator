# Next Steps

Last updated: 2026-04-22

## Current Status

- Branch: `master`
- Last pushed commit before this session: `6c3792f Fix Seoul provider pagination test`
- Festival/event clustering was completed in the iOS map layer with iOS build number 63.

## Completed This Session

Festival/event clustering on the iOS Kakao map.

Touched files:

- `ios-app/Features/Map/KakaoParkingMapView.swift`
- `ios-app/Features/Map/MapHomeView.swift`
- `ios-app/Features/Map/MapHomeViewModel.swift`
- `ios-app/Tests/ParkingLotNavigatorTests.swift`
- `ios-app/project.yml`

Implemented behavior:

- Parking, festival, and event clusters use the same zoom threshold.
- Zoom level `< 12`: show clusters.
- Zoom level `>= 12`: show individual pins.
- Parking/festival/event clusters should not overlap when their cluster centers are close or identical.
- Tapping a festival/event cluster should zoom in, similar to realtime parking clusters.
- Festival/event cluster calculation uses the same 45 km cluster size as realtime parking clusters.
- Cluster markers render with dynamic count styles for festival and event layers.
- Cluster markers are visually offset by layer, but tapping a cluster zooms toward the real cluster center.
- Unit coverage was added for the shared cluster zoom threshold and basic festival/event cluster grouping.

Validation:

- Run `git diff --check` before committing.
- Run local iOS tests/build if Xcode tooling is available; otherwise rely on CI/Codemagic for full iOS validation.
- GitHub Actions now includes `iOS Simulator Build`, which runs backend tests, generates the Xcode project, builds the iOS app for simulator, and runs iOS unit tests.

## After Worker Deploys

- If realtime provider changes are deployed, run or wait for realtime cache sync.
- Verify `/parking/realtime` and `/parking/realtime/clusters` behavior from the production Worker.
- In app, verify realtime toggle after sync.

## Backlog

- Get exact Seongdong IoT Seoul Open Data service name/field map if the provider still returns no rows.
- Add more regional realtime providers as approvals arrive.
- Improve provider health/debug visibility without exposing secrets.
- Add a small admin preview endpoint for individual providers if future provider debugging remains slow.

## New Session Prompt

Use this at the start of a new Codex session:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md. Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
