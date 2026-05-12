# Decisions

Last updated: 2026-05-12

## Product Direction

- Shift the main app experience from realtime parking to local festival/event discovery.
- Keep parking recommendations as a practical support flow after the user chooses a destination, event, or festival.
- Preserve the existing parking flow as a secondary path: destination search -> nearby parking recommendations.
- Continue expanding from Seoul-centered parking recommendations to nationwide parking recommendations.
- Build the app as a destination companion: choose an event/festival/place, then compare nearby parking without leaving the map context.
- Keep realtime parking as a map toggle, off by default.
- Use Cloudflare Worker as production backend.
- Use Cloudflare D1 for normalized parking data and realtime cache.
- Keep map discovery controls simple: one user-facing toggle named "이벤트" for all event/festival providers.
- Keep provider/source distinctions in data and filters, not as separate map toggles.

## Brand/UI Direction

- Use the ticket-shaped festival mascot as the recognizable app character.
- Prefer mascot-led empty states, guide/tip surfaces, detail placeholders, and friendly discovery moments.
- The mascot can change pose/form by context, but should remain clearly the same character.
- Figma is the design reference source, but implementation should keep SwiftUI structure maintainable and app-native.
- The visual tone should feel like a festival/event guide rather than a parking utility.

## Data Strategy

- Avoid calling large public APIs directly for every app request.
- Store nationwide static parking data in D1.
- Use D1 for fast nearby search.
- Merge regional realtime providers on top of static/provider candidates.
- Use Kakao Local `category_group_code=PK6` as a fallback for broad candidate coverage.
- Expand event/festival discovery nationally through official APIs before scraping.
- Current discovery sources include TourAPI, national culture festival standard data, Seoul Open Data, Culture Portal, KOPIS, KCISA id 428, and KCISA id 196.
- Rows without usable coordinates can be geocoded by Kakao Local during sync where configured; unresolved rows are omitted from map pin display.
- Several official list APIs have sparse descriptions. Prefer showing upstream descriptions when present and a generated structured summary when absent; add detail API enrichment later.

## Realtime Strategy

- Use D1 realtime cache for map-wide realtime display.
- Sync cadence target: about 5 minutes.
- Realtime toggle should show nationwide data, not only the current viewport.
- Realtime parking pins render from the loaded realtime lot list instead of numeric server/app clusters.
- Realtime parking pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.
- Event detail parking recommendations should merge normal nearby parking and realtime parking before ranking.
- If realtime parking fails, nearby parking recommendations should continue to render.

## Seoul Realtime Details

- `GetParkingInfo` has realtime counts but no coordinates.
- `GetParkInfo` has metadata and some coordinates.
- Seoul realtime provider merges `GetParkingInfo` and `GetParkInfo` by `PKLT_CD`.
- For remaining Seoul realtime rows without coordinates, Kakao address search may be used in large-radius realtime sync contexts.
- Hangang `TbParkingInfoView` has coordinates and capacity, but does not provide realtime available spaces.

## iOS Map Layer Decisions

- Realtime parking toggle label should be simple and not duplicate the parking symbol.
- Festival/event providers are displayed through one map toggle named "이벤트".
- Festival/event layers do not use numeric clustering. They render actual pins.
- Festival/event pins hide title labels until deep zoom.
- Festival/event pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.
- The map bottom panel uses tabs for parking recommendations and a unified discovery list.
- The discovery list uses already-loaded local data for search and sorting; default sort is distance, with date and name options.
- Discovery list distance sorting/display uses the user's current location when available, falling back to provider distance only before location is known.
- Map pin taps and event tab row taps should open the same event detail + nearby parking recommendation screen.
- The event tab should load discovery data only when selected, unload after leaving, and render rows in pages of 20 to avoid SwiftUI list/diff stalls.

## Build/Release

- When committing changes, bump iOS build number by one.
- Before TestFlight upload, confirm Codemagic's publish log shows a `Version code` higher than the previous App Store Connect build.
- A publish attempt on 2026-05-09 failed because the uploaded IPA still had build number 79 while App Store Connect already had build 79.
- A later publish attempt failed because the uploaded IPA still had build number 95 while App Store Connect already had build 95.
- Current build metadata target is `1.0 (105)`.
- Codemagic/TestFlight is used for iOS build validation.
- GitHub Actions also runs an iOS simulator validation workflow on pushes and pull requests.
- Backend tests run in CI/Codemagic.
- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
