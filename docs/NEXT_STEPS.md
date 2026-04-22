# Next Steps

Last updated: 2026-04-22

## Current Status

- Branch: `master`
- Last pushed commit before this session: `6c3792f Fix Seoul provider pagination test`
- Realtime parking still uses screen-space clusters, while festival/event layers use overlap-collapsed pins with iOS build number 69.

## Completed This Session

Festival/event map display refinement on the iOS Kakao map.

Touched files:

- `ios-app/Features/Map/KakaoParkingMapView.swift`
- `ios-app/Features/Map/MapHomeView.swift`
- `ios-app/Features/Map/MapHomeViewModel.swift`
- `ios-app/Tests/ParkingLotNavigatorTests.swift`
- `ios-app/project.yml`

Implemented behavior:

- Festival/event numeric clusters were removed.
- Festival/event layers now render actual pins.
- Festival/event pins that overlap in screen space collapse to one representative pin while zoomed out.
- Overlapping festival/event pins separate with small offsets after zooming in.
- Festival/event title labels only show at deep zoom.
- Realtime parking display clusters are calculated client-side from the same loaded realtime lots used for individual pins, so counts stay aligned when zooming in.
- Realtime parking cluster release is back at zoom `14`.

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
