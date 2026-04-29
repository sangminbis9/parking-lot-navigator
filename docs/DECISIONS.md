# Decisions

Last updated: 2026-04-29

## Product Direction

- Expand from Seoul-centered parking recommendations to nationwide parking recommendations.
- Preserve the existing core flow: destination search -> nearby parking recommendations.
- Expand the app toward a destination companion flow: choose a place, then compare nearby parking, lodging, and event/festival options without leaving the map context.
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
- Lodging is a separate discovery toggle beside realtime parking, festivals, and events.
- Festival/event layers do not use numeric clustering. They render actual pins.
- Festival/event/lodging layers do not use numeric clustering. They render actual pins.
- Festival/event/lodging pins hide title labels until deep zoom.
- Festival/event/lodging pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.
- The map bottom panel uses tabs for parking recommendations and a unified discovery list.
- The discovery list uses already-loaded local data for search and sorting; default sort is distance, with date and name options.
- Discovery list distance sorting/display uses the user's current location when available, falling back to provider distance only before location is known.
- Discovery detail "map view" actions stay inside the app, focus the Kakao map near zoom 16, set the item as the destination, load nearby parking, and enable/load realtime parking.

## Lodging Comparison Strategy

- Phase 1 uses Korea Tourism Organization TourAPI lodging data as the first real lodging provider, with Kakao Local accommodation category search as fallback.
- Lodging results include a normalized lodging record, source URL when available, amenity/contact hints, and distance from the selected place. Per-platform offers and lowest-price text are optional because domestic public APIs do not provide live booking prices.
- Lodging credentials stay server-side only. The app must not embed booking API secrets or scrape booking pages directly.
- Additional providers such as Expedia Rapid or Booking.com Demand API can be layered later, but each needs partner credentials and provider-specific location/date rules.

## Build/Release

- When committing changes, bump iOS build number by one.
- Codemagic/TestFlight is used for iOS build validation.
- GitHub Actions also runs an iOS simulator validation workflow on pushes and pull requests.
- Backend tests run in CI/Codemagic.
- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
