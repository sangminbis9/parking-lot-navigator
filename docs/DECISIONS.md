# Decisions

Last updated: 2026-04-22

## Product Direction

- Expand from Seoul-centered parking recommendations to nationwide parking recommendations.
- Preserve the existing core flow: destination search -> nearby parking recommendations.
- Keep realtime parking as a map toggle, off by default.
- Use Cloudflare Worker as production backend.
- Use Cloudflare D1 for normalized parking data and realtime cache.

## Data Strategy

- Avoid calling large public APIs directly for every app request.
- Store nationwide static parking data in D1.
- Use D1 for fast nearby search.
- Merge regional realtime providers on top of static/provider candidates.
- Use Kakao Local `category_group_code=PK6` as a fallback for broad candidate coverage.

## Realtime Strategy

- Use D1 realtime cache for map-wide realtime display.
- Sync cadence target: about 5 minutes.
- Realtime toggle should show nationwide data, not only the current viewport.
- Zoomed out map should show wide clusters; mid-zoom map should show narrower clusters; zoomed in map should show individual pins.
- Parking/festival/event cluster thresholds:
  - Zoom level `< 12`: show 45 km clusters.
  - Zoom level `12` to `13`: show 12 km clusters.
  - Zoom level `>= 14`: show individual pins.

## Seoul Realtime Details

- `GetParkingInfo` has realtime counts but no coordinates.
- `GetParkInfo` has metadata and some coordinates.
- Seoul realtime provider merges `GetParkingInfo` and `GetParkInfo` by `PKLT_CD`.
- For remaining Seoul realtime rows without coordinates, Kakao address search may be used in large-radius realtime sync contexts.
- Hangang `TbParkingInfoView` has coordinates and capacity, but does not provide realtime available spaces.

## iOS Map Layer Decisions

- Realtime parking toggle label should be simple and not duplicate the parking symbol.
- Realtime parking clusters use the same zoom thresholds as parking realtime pins.
- Festival/event layers are separate toggles.
- Festival/event pins may show labels only when zoomed in or selected.
- Festival/event clusters use the same zoom thresholds as parking clusters.
- Zoomed-out parking, festival, and event clusters are offset by layer so same or nearby cluster centers do not render directly on top of one another.

## Build/Release

- When committing changes, bump iOS build number by one.
- Codemagic/TestFlight is used for iOS build validation.
- GitHub Actions also runs an iOS simulator validation workflow on pushes and pull requests.
- Backend tests run in CI/Codemagic.
- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
