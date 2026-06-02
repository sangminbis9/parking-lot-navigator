# Project State

Last updated: 2026-06-02

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
- `KAKAO_CLIENT_SECRET` (Kakao Login client secret, OAuth)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (Naver Login + blog/local search)
- `SEOUL_OPEN_DATA_KEY`
- `SEOUL_SEONGDONG_IOT_KEY` if used separately; otherwise Seoul key fallback exists.
- `SEOUL_HANGANG_PARKING_KEY` if used separately; otherwise Seoul key fallback exists.
- `PUBLIC_DATA_SERVICE_KEY`
- `CULTURE_PORTAL_API_KEY` optional; falls back to `PUBLIC_DATA_SERVICE_KEY` for Culture Portal where applicable.
- `KOPIS_API_KEY`
- `KCISA_428_API_KEY`
- `KCISA_196_API_KEY`
- `SYNC_ADMIN_TOKEN`
- `MERCHANT_SESSION_SECRET` (HS256 JWT signing key for merchant session cookies)
- `TOSS_SECRET_KEY` (Toss Payments widget secret key; `TOSS_CLIENT_KEY` lives in `wrangler.toml` vars)
- Cloudflare/GitHub Actions deploy secrets

The deploy CI uses `wrangler versions secret put` so multiple secrets can be staged in one new Worker version and applied together at the final `wrangler deploy` step.

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

Event/festival discovery layer:

- The map exposes one user-facing toggle named "이벤트".
- That single toggle shows all festival/event pins from existing public data, Seoul Open Data, TourAPI, Culture Portal, KOPIS, and KCISA providers.
- API/source-specific switches are not shown on the map UI.
- The event tab still supports category/source-aware filtering internally, but the user-facing filter is centered on event kind.
- The event tab loads discovery data only when the event tab is selected.
- Leaving the event tab cancels active loading and defers cleanup briefly so tab switching stays responsive.
- The event tab renders 20 rows initially and loads 20 more when the user scrolls to the bottom.
- Map event pins and event tab rows now open the same event detail + nearby parking recommendation screen.
- Event recommendation screens merge normal nearby parking with realtime parking before ranking.
- If realtime parking fails but normal nearby parking succeeds, the recommendation screen still works.
- Event detail screens show every currently available field: description, date, venue, address, price, region, source, source URL, updated timestamp, image, and tags.
- Some upstream APIs provide weak or missing long descriptions. When no description is available, the app displays a generated summary from title, date, place, type, price, and source.

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

Major discovery providers:

- TourAPI festival provider via data.go.kr / KTO TourAPI.
- National culture festival standard data via data.go.kr.
- Seoul Open Data cultural events.
- Culture Portal "한눈에보는문화정보" / public culture information.
- KOPIS performance list.
- KCISA Culture API id 428, source id `kcisa_428`.
- KCISA Culture API id 196, source id `kcisa_196`.

## Local Events (separate domain from Festivals)

- Local events live in D1 table `local_events`; they represent restaurant/cafe/shop discounts, freebies, popups, limited menus, and opening events.
- Production discovery uses Naver Open API + Kakao Local Keyword:
  1. Naver Blog / Cafe Article / News Search across 21 event-shaped keywords (카페·맛집·식당·디저트·베이커리·팝업 variants) over 85 region centers.
  2. Kakao Local Keyword Search matches each post's store name to a place id, address, and coordinates.
  3. Matches are deduped per Kakao place id; events without `end_date` may still be approved when the score clears the threshold.
- Worker subrequest budget is split per invocation: `LOCAL_EVENT_SEARCH_MAX_QUERIES = 17`, `LOCAL_EVENT_MAX_KAKAO_LOOKUPS = 30` to stay under the 50-subrequest free-tier ceiling.
- Auto-approve threshold: `LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE = "0.75"`.
- Status states: `pending`, `pending_payment`, `approved`, `rejected`, `expired`.
- Public API (`/api/local-events`) only serves rows where `status = 'approved'` and `(is_sponsored = 0 OR paid_until > now)`. Pending and unpaid merchant events are excluded.

### Agent Office (LLM head review)

- `agent_activity` D1 table logs scout/orion/echo agent actions for the in-app Agent Office surface.
- Head agent `orion` runs on Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) and emits `approve / pending / reject` verdicts with a Korean rationale per candidate.
- Workers AI is bound as `[ai] binding = "AI"` in `wrangler.toml`; no external API key required.
- Sync invocation logs `scout.found`, head review invocation logs `orion.validate` (and `echo.post` when the verdict is `approve`).
- `GET /agent-office/activity` exposes the recent activity feed; iOS AgentOffice scene reads it for live LLM bubbles.

## Merchant / Paid Event Registration

- Merchant signup landing: `https://parking-lot-navigator-api.parkingnav.workers.dev/merchant`.
- Auth: Naver Login OAuth and Kakao Login OAuth. Session is a HS256 JWT in an HttpOnly Secure SameSite=Lax cookie, signed with `MERCHANT_SESSION_SECRET`. CSRF state cookie protects the OAuth callback.
- Event form: title, description, benefit, event type, store name, address (Kakao geocoded with keyword fallback), start/end date, image (uploaded directly to R2 bucket `merchant-images`, max 5 MB jpeg/png/webp, client-side compressed to max 1600px / quality 0.85 before upload).
- R2 image serving: `GET /merchant/images/:key` streams from R2 with immutable cache headers.
- Pricing: `EVENT_PRICE_KRW = 10000` per event, `EVENT_DURATION_MONTHS = 3`. `paid_until = startDate + 3 months`.
- Payment integration: Toss Payments **결제위젯 v2** (`https://js.tosspayments.com/v2/standard`).
  - Test keys (current): `TOSS_CLIENT_KEY = test_gck_docs_...` in `wrangler.toml`, `TOSS_SECRET_KEY = test_gsk_docs_...` as wrangler secret.
  - Production keys must be the **결제위젯 연동 키** family (`live_gck_...` / `live_gsk_...`), not the "API 개별 연동 키".
- Payment flow: `pending_payment` row created on form submit → Toss widget renders at `/merchant/event/:id/pay` → success callback hits `/merchant/event/:id/payment/success`, validates orderId/amount, calls `confirmTossPayment`, then `markEventApproved` flips status to `approved`.
- iOS link-out: Settings screen has "내 가게 이벤트 등록" card opening Safari to `/merchant` (Apple IAP avoidance via App Store guideline 3.1.3(b) B2B carve-out — no in-app purchase prompt).

## Cloudflare Resources

- D1 binding: `DB` (`parking-lot-navigator`, id `31c04846-57d5-4e38-82b6-2d7b3a0dfbee`).
- R2 binding: `MERCHANT_IMAGES` (bucket `merchant-images`).
- Worker triggers: cron `* * * * *` (realtime parking), `0 * * * *` (hourly maintenance), `15 * * * *` (local event sync chunk), `30 */3 * * *` (head agent review).
- Workers AI binding: `AI` (used by `orion` head agent).

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
- Tab bar order is `지도 → 이벤트 → 즐겨찾기 → 캘린더 → 사무실 → 설정` (six tabs). The 캘린더 tab is a themed monthly grid with an inline agenda below it: selecting a day lists that day's festivals in place (no detail sheet), with per-festival 즐겨찾기 저장(별표) and 시작 전 로컬 알림(종) 토글, swipe-to-change-month, and "오늘 / 이번 주말" presets.
- Shared filter axes used by the calendar and widget: 지역(시·도), 거리 반경(10/20/50km/무제한), 태그/장르, 진행 상태(진행중/예정). Filter state is persisted in App Group `UserDefaults` and consumed by both surfaces.

## Calendar + Widget Architecture

- The 캘린더 탭은 `/api/festivals` (alias `/discover/festivals`) 응답을 `upcomingWithinDays=90` 으로 받아 `[Date: [Festival]]` 버킷으로 정리하고, 날짜 셀에 dot 인디케이터(진행 중 → teal, 예정 → lantern)를 표시한다.
- iOS 홈 화면 **Medium 위젯** `UpcomingFestivalsWidget` 가 다가오는 축제 3개를 카드 형태로 노출한다. 위젯은 네트워크를 직접 호출하지 않고 App Group container 의 `widget_festivals.json` 캐시만 읽는다.
- `FestivalSyncService` (앱 본체) 가 cold start, foreground 진입, 필터 변경 시 `/api/festivals` 를 호출 → 필터 적용 → 상위 ~20개를 `SharedFestivalCache` 에 저장 → `WidgetCenter.shared.reloadTimelines(ofKind: "UpcomingFestivalsWidget")` 를 호출한다.
- App Group ID 는 기존 메인 앱이 쓰던 `group.com.sangminbis9.ParkingLotNavigator` 를 재사용한다. 위젯 entitlements 도 동일한 그룹을 참조한다.
- 위젯 extension Bundle ID: `com.sangminbis9.ParkingLotNavigator.UpcomingFestivalsWidget` (project.yml 에서 `$(APP_BUNDLE_ID).UpcomingFestivalsWidget` 으로 inline 파생).
- 위젯 target sources: `Integrations/WidgetKit`, `Core/Models`, `Core/Storage`, `Core/DesignSystem` (위젯 target 에는 `Core/Logging` 미포함 — `SharedFestivalCache` 는 silent `try?` 실패).
- iOS deployment target 16.0 호환을 위해 `containerBackground(_:for: .widget)` 은 iOS 17+ 분기로 처리.
- EventKit 연동(축제 → 기본 캘린더 추가)은 v1.1 로 deferred. v1 에서는 NSCalendarsUsageDescription 미도입.

## Notifications (로컬 알림, 서버 푸시 없음)

- 알림은 전부 **로컬 알림**(`UNUserNotificationCenter`)이다. APNs/서버 푸시 인프라는 없다.
- 설정 → "알림"(`NotificationSettingsView`)에서 축제/로컬 이벤트 알림을 **각각 별도 섹션**으로 커스터마이즈한다: 마스터 on/off, 카테고리 다중 선택, 지역(시·도)/반경(10/20/50km), 축제 한정 "저장한 축제 리마인더" 시점(당일/1·3·7일 전)·시각, 공통 방해 금지 시간·하루 최대 알림 수.
- 설정값은 App Group `UserDefaults` 키 `notificationPreferences` 에 저장한다(`NotificationPreferencesStore` / `NotificationPreferencesModel`).
- **새 항목 발견 알림**: `DiscoveryNotificationService` 가 `BGAppRefreshTask`(id `com.parkingnav.discovery.refresh`)로 깨어나 관심 조건에 맞는 좌표/반경으로 `/api/festivals`·`/api/local-events` 를 조회 → 카테고리 필터 → 이미 알린 ID 집합과 비교해 신규만 추출 → 방해 금지 시간/일일 한도를 적용해 **도메인별 요약 1건**의 로컬 알림을 보낸다. 알린 ID·일일 카운터·마지막 좌표(`lastKnownLocation.*`)도 App Group 에 저장한다.
- 조회 중심 좌표: 선택 지역이 있으면 시·도 centroid 평균, 없으면 `CurrentLocationProvider` 가 저장한 마지막 좌표, 그래도 없으면 서울시청.
- 백그라운드 실행 시점은 iOS 가 결정하므로 best-effort(지연/누락 가능). 발견 알림이 모두 꺼지면 `BGTaskScheduler` 예약을 취소한다.
- 저장한 축제 리마인더(`FestivalReminderService`)는 위 설정의 on/off·시점·시각을 따른다(이전엔 시작 전날 오전 9시 고정).
- iOS Info.plist 추가: `UIBackgroundModes=[fetch]`, `BGTaskSchedulerPermittedIdentifiers=[com.parkingnav.discovery.refresh]`. 위치는 when-in-use 만 사용(백그라운드 위치·Always 권한 불필요).

## Recent Useful Commits

Latest (2026-06-02):

- `3e64067 Add customizable festival/local-event notification settings with background discovery`
- `c587edd Revamp calendar tab: inline agenda, category-colored dots, swipe nav, save & local-notification reminders`
- `cea4fca Optimize: 60s edge cache + single tags parse (Worker), hoist formatters/Calendar (iOS), remove dead discover-list code`

Earlier (2026-05-26):

- `c65a3a5 Derive widget bundle id from app bundle id to fix embed validation`
- `f3465f2 Add festival calendar tab, Medium widget, and shared filter store`
- `b2ade17 Add legal pages route, iOS Privacy Manifest, and App Store privacy answers`
- `795f018 Bump iOS build number to 131`
- `7ebe783 Update app icon and display name`
- `9727bdf Lower Eventda icon wordmark`

Earlier (2026-05-19):

- `116fbcb Widen local event sources, rebalance subrequest budget`
- `a0c9d5d Add Workers AI head agent and activity feed`
- `9d8be9d Stage Worker secrets with versions secret put in CI`
- `c31bf14 Add merchant signup link-out in Settings`
- `a5edbd8 Hide expired sponsored events from /api/local-events`
- `5b38483 Wire Toss Payments widget for merchant event publishing`
- `52a133e Add event start date and direct image upload to R2`
- `becadbf Use Kakao client secret when configured`
- `13908cd Add merchant signup landing with Naver/Kakao OAuth`

Local event discovery tuning:

- `ae62f0d Lower local event auto-approve threshold to 0.75`
- `4bcc86a Approve local events without end_date when score clears threshold`
- `6cde706 Fill nationwide blind spots in local event regions`
- `d3a1d8a Dedupe local events by matched Kakao place id`
- `c54b414 Improve blog store-name extraction heuristics`
- `14fc382 Switch local event discovery to Naver Blog + Kakao Keyword`
- `dc4008f Skip blog matches whose event keyword is followed by negation`

Earlier discovery/parking work:

- `6c96a20 Include realtime parking in event recommendations`
- `3bdd7bd Unify event detail navigation`
- `c55f447 Defer event list cleanup on tab switch`
- `1eef0f4 Optimize event tab list loading`
- `a11ebdd Set Codemagic build fallback to 105`
- `6c3792f Fix Seoul provider pagination test`
- `69b3274 Enrich Seoul realtime parking coordinates`
- `5af815e Fix Seoul supplemental parking mapping`
