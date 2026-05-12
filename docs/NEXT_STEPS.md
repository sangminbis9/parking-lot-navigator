# Next Steps

Last updated: 2026-05-12

## Current Status

- Branch: `master`
- Latest pushed commit: `6c96a20 Include realtime parking in event recommendations`
- Product direction is festival/event discovery first, with parking/realtime as support for visiting selected destinations.
- Realtime parking and festival/event layers use overlap-collapsed pins.
- iOS build number is `1.0 (105)` in `ios-app/project.yml`; Codemagic fallback build number is also `105`.
- Worker discovery and parking reads use D1/user endpoints with cron/admin sync for external provider calls.
- Previous App Store Connect upload failures were caused by duplicate `CFBundleVersion` values. Future uploads must always use a build number higher than the latest uploaded build.

## Completed This Session

Nationwide event API expansion, event tab performance work, unified event detail navigation, and realtime parking inclusion in event recommendations.

Additional touched files:

- `backend/src/features/discover/events/CulturePortalEventProvider.ts`
- `backend/src/features/discover/events/KopisEventProvider.ts`
- `backend/src/features/discover/events/KcisaCultureEventProvider.ts`
- `backend/src/features/discover/events/eventProviderUtils.ts`
- `backend/src/features/discover/events/eventService.ts`
- `shared-types/src/discover.ts`
- `ios-app/Core/Models/DiscoverItem.swift`
- `ios-app/Features/Search/SearchView.swift`
- `ios-app/Features/ParkingResults/ParkingResultsView.swift`
- `ios-app/Features/ParkingResults/ParkingResultsViewModel.swift`

Implemented behavior:

- Added national event/culture providers for Culture Portal, KOPIS, KCISA id 428, and KCISA id 196.
- Kept the map UI simple with one event toggle named "이벤트".
- Merged new and existing event/festival sources into the same app-level event experience.
- Added source IDs for internal filtering and logging: `culture_portal`, `kopis`, `kcisa_428`, `kcisa_196`, `existing_public_data`, and `seoul_open_data`.
- Preserved category-level user filters in the event tab: all, festival, performance, exhibition, culture event, local event, and other.
- Added best-effort address-to-coordinate resolution for rows without coordinates through Kakao Local where configured.
- Added API failure isolation so a provider failure does not break the entire event feature.
- Updated event tab loading so it only loads while the tab is selected.
- Cleared event tab list data after leaving the tab, with deferred cleanup to avoid slow tab switching.
- Rendered event tab list rows in pages of 20 with infinite-scroll loading.
- Reverted the temporary map pin cap; map pin behavior remains source-driven and uses existing overlap handling.
- Unified map pin taps and event tab row taps to the same event detail + nearby parking recommendation screen.
- Expanded event detail fields to show description, fallback generated summary, date, venue, address, price, region, source, official/source URL, updated timestamp, image, and tags.
- Updated the event nearby parking recommendation flow to merge `/parking/nearby` and `/parking/realtime` results before ranking.
- Realtime parking failures no longer block normal nearby parking recommendations.

Known limitation:

- Several upstream list APIs do not provide rich long-form event descriptions. The app shows any provided description, otherwise it generates a concise summary from available structured fields. Richer descriptions require provider-specific detail endpoints, for example KOPIS detail, TourAPI detail, or Culture Portal detail calls.

Festival/event map display, mascot branding, and list/detail refinement on the iOS Kakao map.

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

- The app direction was updated from parking-first to festival/event-first.
- A ticket-shaped festival mascot was split into app-ready asset catalog image sets.
- Transparent mascot variants were added for main, icon, jump, guide, and night states.
- The iOS map/search/discovery UI now uses the mascot direction and festival palette.
- Search, parking results, parking detail, route preview, floating map controls, and map pin colors now share the festival design direction.
- Discovery empty states, detail imagery, and header/tip surfaces use mascot artwork.
- Festival/event numeric clusters were removed.
- Festival/event layers now render actual pins.
- Festival/event pins that overlap in screen space collapse to one representative pin while zoomed out.
- Overlapping festival/event pins separate with small offsets after zooming in.
- Festival/event title labels only show at deep zoom.
- Realtime parking numeric clusters were removed.
- Realtime parking pins that overlap in screen space collapse to one representative pin while zoomed out.
- Overlapping realtime parking pins separate with small offsets after zooming in.
- The iOS app loads realtime parking lots directly and no longer requests realtime cluster data for map rendering.
- The map and discovery surfaces prioritize event/festival exploration while keeping parking recommendations available around a selected destination.
- The event/festival tab shows a unified list with thumbnail images, type/status badges, venue/address text, date, and distance.
- The event/festival list supports local search and distance/date/name sorting.
- Event/festival list distance values and distance sorting use the user's current location when available.
- Tapping a list row opens the existing detail sheet with a main image area.
- The detail sheet map action stays in app, focuses the Kakao map on the selected item, sets it as the destination, loads nearby parking, and enables/loads realtime parking.
- Note: map event pins no longer use the old map-only detail sheet as the primary path. They now route to the same detailed event/parking recommendation screen as the event tab.

Validation:

- Before the next Codemagic/TestFlight run, confirm the publish log says `Version code: 105` or higher.
- Run `git diff --check` before committing.
- Run local iOS tests/build if Xcode tooling is available; otherwise rely on CI/Codemagic for full iOS validation.
- GitHub Actions now includes `iOS Simulator Build`, which runs backend tests, generates the Xcode project, builds the iOS app for simulator, and runs iOS unit tests.

## After Worker Deploys

- Apply D1 migrations, including `worker-backend/migrations/0003_discovery_items.sql`.
- If realtime or discovery provider changes are deployed, run or wait for cron sync.
- Verify `/parking/nearby`, `/parking/realtime`, `/discover/festivals`, and `/discover/events` behavior from the production Worker.
- In app, verify realtime toggle after sync.
- In app, verify event detail recommendation rows include realtime-capable parking where available.

## Backlog

- Configure `PUBLIC_DATA_SERVICE_KEY`, `SEOUL_OPEN_DATA_KEY`, `CULTURE_PORTAL_API_KEY`, `KOPIS_API_KEY`, `KCISA_428_API_KEY`, `KCISA_196_API_KEY`, and `KAKAO_REST_API_KEY` in Worker secrets, then verify discovery admin sync and D1-backed `/discover/*` endpoints.
- Add provider-specific detail enrichment for event descriptions where official APIs provide detail endpoints.
- Get exact Seongdong IoT Seoul Open Data service name/field map if the provider still returns no rows.
- Add more regional realtime providers as approvals arrive.
- Improve provider health/debug visibility without exposing secrets.
- Add a small admin preview endpoint for individual providers if future provider debugging remains slow.

## New Session Prompt

Use this at the start of a new Codex session:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md. Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
