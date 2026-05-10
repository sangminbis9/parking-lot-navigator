# Project State

Last updated: 2026-05-10

## Project

- App: Parking_Lot_Navigator
- Repository: `sangminbis9/parking-lot-navigator`
- Main branch: `master`
- Local path: `C:\Users\sangm\OneDrive\문서\Coding\parking-lot-navigator`
- Production Worker: `https://parking-lot-navigator-api.parkingnav.workers.dev`

## Components

- `backend`: TypeScript + Fastify API/provider/ranking logic.
- `worker-backend`: Cloudflare Workers + Hono production API.
- `ios-app`: SwiftUI app using Kakao Maps.
- `shared-types`: Shared TypeScript API/domain types.

## Runtime

- Production API is the Cloudflare Worker backend.
- Railway is no longer used.
- Worker D1 binding: `DB`
- D1 database: `parking-lot-navigator`
- D1 database id: `31c04846-57d5-4e38-82b6-2d7b3a0dfbee`
- Worker cron: every 5 minutes for realtime parking cache sync.

## Secrets

Do not write real API keys or admin tokens into repo docs or chat summaries.

Required production secret names include:

- `KAKAO_REST_API_KEY`
- `SEOUL_OPEN_DATA_KEY`
- `SEOUL_SEONGDONG_IOT_KEY` if used separately; otherwise Seoul key fallback exists.
- `SEOUL_HANGANG_PARKING_KEY` if used separately; otherwise Seoul key fallback exists.
- `PUBLIC_DATA_SERVICE_KEY`
- `SYNC_ADMIN_TOKEN`
- Cloudflare/GitHub Actions deploy secrets

## Current Provider Shape

The product is now festival/event discovery first, with parking as the practical support layer for visiting a selected destination.

Main discovery flow:

1. User opens the app around local festival/event content.
2. App shows festival/event layers, discovery list, search, detail, and in-app map focus.
3. When the user chooses an event/festival, the app can set it as the destination.
4. Nearby parking recommendations and realtime parking help the user visit that destination.

Parking recommendation flow:

1. User searches destination.
2. App calls nearby parking API around destination.
3. Providers merge/dedupe/rank candidates.
4. Destination parking candidates should remain prioritized when destination itself is a parking lot.

Realtime map layer:

- iOS realtime toggle is off by default.
- When enabled, app loads nationwide realtime pins/clusters from Worker/D1 cache.
- Realtime cache is backed by D1 table `realtime_parking_status`.
- Realtime cache sync is intended to run every 5 minutes.

Major parking providers:

- Seoul realtime: `GetParkingInfo`
- Seoul metadata: `GetParkInfo`
- Seoul supplemental:
  - Seongdong IoT shared parking provider
  - Hangang parking provider using `TbParkingInfoView`
- Daejeon realtime
- Daegu Suseong realtime
- KAC airport realtime
- Incheon airport realtime
- National static D1 data
- TS Korea
- Kakao Local PK6 fallback

## Current iOS UX/Brand

- The event/festival experience is the primary surface; realtime parking remains a toggle/support layer.
- A ticket-shaped festival mascot is the app's main character direction.
- Mascot assets live in `ios-app/Resources/Assets.xcassets`:
  - `FestivalMascotMain`
  - `FestivalMascotIcon`
  - `FestivalMascotJump`
  - `FestivalMascotGuide`
  - `FestivalMascotNight`
  - `FestivalMascotConcept`
- SwiftUI map/discovery UI now uses the mascot and a warmer festival palette across search, list, empty states, detail imagery, and helper/tip surfaces.
- Figma redesign reference: `Festival-Event-App-Redesign`.

## Recent Useful Commits

- Latest local work: apply festival mascot direction across iOS search, parking, navigation, map overlays, and bump iOS build number to 81.
- Latest work: remove accommodation discovery/display paths and keep discovery focused on event/festival layers.
- `6c3792f Fix Seoul provider pagination test`
- `69b3274 Enrich Seoul realtime parking coordinates`
- `5af815e Fix Seoul supplemental parking mapping`
- `1488442 Add Seoul supplemental parking providers`
- `4eecc3a Keep realtime layer nationwide`
