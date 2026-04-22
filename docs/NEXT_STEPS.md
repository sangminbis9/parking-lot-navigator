# Next Steps

Last updated: 2026-04-22

## Current Status

- Branch: `master`
- Last pushed commit: `6c3792f Fix Seoul provider pagination test`
- There are local uncommitted iOS changes for festival/event clustering.

## In Progress

Festival/event clustering on the iOS Kakao map.

Touched files:

- `ios-app/Features/Map/KakaoParkingMapView.swift`
- `ios-app/Features/Map/MapHomeView.swift`
- `ios-app/Features/Map/MapHomeViewModel.swift`

Desired behavior:

- Parking, festival, and event clusters use the same zoom threshold.
- Zoom level `< 11`: show clusters.
- Zoom level `>= 11`: show individual pins.
- Parking/festival/event clusters should not overlap when their cluster centers are close or identical.
- Tapping a festival/event cluster should zoom in, similar to realtime parking clusters.

Implementation direction already started:

- `DiscoverCluster` model added in `MapHomeViewModel.swift`.
- Festival/event cluster calculation added client-side using 45 km grid.
- `MapPinItem.Kind` now includes `festivalCluster` and `eventCluster`.
- `MapHomeView.swift` started switching festival/event pins to clusters at zoomed-out levels.
- Cluster coordinates are offset by layer so parking/festival/event clusters do not sit directly on top of each other.
- `KakaoParkingMapView.swift` started adding dynamic cluster styles for festival/event clusters.

Before committing:

- Review Swift compile correctness around the new `DiscoverCluster` and `MapPinItem.Kind` cases.
- Make sure all `switch` statements over `MapPinItem.Kind` handle:
  - `festivalCluster`
  - `eventCluster`
- Bump iOS build number once before commit.
- Run whatever validation is available. If local toolchain is missing, at minimum run `git diff --check`.

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

