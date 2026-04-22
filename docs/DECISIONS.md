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
- Realtime parking pins render from the loaded realtime lot list instead of numeric server/app clusters.
- Realtime parking pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.

## Seoul Realtime Details

- `GetParkingInfo` has realtime counts but no coordinates.
- `GetParkInfo` has metadata and some coordinates.
- Seoul realtime provider merges `GetParkingInfo` and `GetParkInfo` by `PKLT_CD`.
- For remaining Seoul realtime rows without coordinates, Kakao address search may be used in large-radius realtime sync contexts.
- Hangang `TbParkingInfoView` has coordinates and capacity, but does not provide realtime available spaces.

## iOS Map Layer Decisions

- Realtime parking toggle label should be simple and not duplicate the parking symbol.
- Festival/event layers are separate toggles.
- Festival/event layers do not use numeric clustering. They render actual pins.
- Festival/event pins hide title labels until deep zoom.
- Festival/event pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.

## Build/Release

- When committing changes, bump iOS build number by one.
- Codemagic/TestFlight is used for iOS build validation.
- GitHub Actions also runs an iOS simulator validation workflow on pushes and pull requests.
- Backend tests run in CI/Codemagic.
- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
