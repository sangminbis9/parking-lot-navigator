# CLAUDE.md

이 저장소에서 작업할 때 Claude가 따라야 할 프로젝트 운영 지침입니다. 답변은 기본적으로 한국어로 하고, 사용자가 코드 변경을 요청하면 분석만 하지 말고 가능한 범위에서 직접 수정, 검증, 커밋/푸시까지 진행합니다.

## 프로젝트 개요

- `ios-app/`: SwiftUI iOS 앱, XcodeGen 기반 프로젝트.
- `worker-backend/`: Cloudflare Worker + Hono + D1 운영 API. 실제 배포 API는 이쪽이 중심이다.
- `backend/`: 로컬 Fastify 백엔드와 provider/test 코드.
- `shared-types/`: iOS/백엔드/Worker가 공유하는 TypeScript DTO 타입.
- `docs/`: 운영, 배포, 개인정보, 아키텍처 문서.

앱의 핵심 기능은 목적지 주변 주차장, 축제, 로컬 매장 이벤트를 지도와 리스트로 보여주는 것이다.

## iOS 앱 현재 상태

- 현재 빌드번호: `286` (`ios-app/project.yml` `CURRENT_PROJECT_VERSION`) — 빌드번호를 올릴 때 이 줄도 같이 고친다.
- iOS 최소 지원 버전: 16+, SwiftUI

### 공연 기능 구조 (build 178 이후)

공연은 KOPIS source 이벤트(`source='kopis'`)와 음악/공연 카테고리 축제(`primary_category='music_performance'`)를 하나의 `PerformanceItem` union으로 묶어 달력 섹션과 지도 레이어 두 곳에 노출한다.

**주요 타입 (`ios-app/Core/Models/DiscoverItem.swift`)**

- `PerformanceItem: Identifiable` enum — `.festival(Festival)` | `.event(FreeEvent)`
  - `id`: `"perf-festival-<id>"` / `"perf-event-<id>"`
  - `startDate`, `endDate`, `lat`, `lng`, `presentation`, `discoverDestination` computed properties
  - `FreeEvent.endDate`는 `String?` → `PerformanceItem.endDate`는 `e.endDate ?? e.startDate`로 non-optional 반환
- `DiscoverPerformancesResponse: Decodable` — `festivals: [Festival]`, `events: [FreeEvent]`, `generatedAt: String`

**API (`ios-app/Core/Networking/APIClient.swift`)**

```swift
func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent])
```

**Worker `/api/performances`**

- `worker-backend/src/discoveryCache.ts`: `queryPerformancesFromCache()` — `discovery_items`의 `type='festival'` 행을 한 번 조회한 뒤 `source`로 가른다. `PERFORMANCE_EVENT_SOURCES`(현재 `kopis`)에 속하면 `events`, 나머지 중 `music_performance` 묶음만 `festivals`로 나간다. KOPIS를 포함한 public API 이벤트는 `discoveryRow`에서 `type='festival'`로 저장되므로 D1에 `type='event'` 행은 존재하지 않는다.
- `worker-backend/src/index.ts`: `GET /api/performances?lat=&lng=&radiusMeters=&upcomingWithinDays=`
- `KOPIS_MAX_PAGES = "10"`, `KOPIS_DETAIL_MAX_ITEMS = "5"` (wrangler.toml 실제값), HTTP 429 → 빈 배열 반환 → 루프 조기 종료

**달력 탭 (`ios-app/Features/Calendar/`)**

- `PerformanceViewModel`: `@MainActor ObservableObject`, 날짜 기준 필터링 (`startDate <= dayKey && endDate >= dayKey`)
- `CalendarTabView`: 축제 어젠다 아래 "근처 공연" 섹션 추가, `@StateObject performanceViewModel`

**지도 탭 (`ios-app/Features/Map/`)**

- `MapHomeViewModel`: `showsPerformanceLayer`, `performances`, `setPerformanceLayerVisible`, `loadPerformanceLayer`
- `MapHomeView`: `discoverSources`에 dedup 로직 (`seenFestivalIds`/`seenEventIds`로 중복 핀 방지), 공연 토글 버튼 (`"music.note"`, `musicPerformance.tint`)

### 축제 필터 구조 (build 177 이후)

축제 필터는 캘린더 탭과 지도 탭이 `FestivalFilterModel` 하나를 공유한다.

**주요 타입 (`ios-app/Core/Storage/FestivalFilterStore.swift`)**

- `FestivalDateRange`: `String, Codable, CaseIterable` enum — 7 cases: `ongoingOnly` / `oneMonth` / `twoMonths` / `threeMonths` / `sixMonths` / `oneYear` / `custom`
  - `upcomingWithinDays`: ongoingOnly=365, oneMonth=30, twoMonths=60, threeMonths=90, sixMonths=180, oneYear=365, custom=365
  - `ongoingOnly`는 API를 넓게(365일) 호출하고 클라이언트에서 `festival.status == .ongoing`만 통과시킨다.
  - `custom`은 API를 최대(365일)로 호출하고 클라이언트에서 날짜 겹침으로 2차 필터링한다.
- `FestivalFilter`: `dateRange: FestivalDateRange`, `customFromDate: String?` ("yyyy-MM-dd"), `customToDate: String?`, `regions: [String]`, `radiusKm: Int?`, `primaryCategories: Set<FestivalPrimaryCategory>`
  - 기본값: `dateRange = .ongoingOnly`, `radiusKm = 50`, 나머지 빈 값
  - `statuses: [DiscoverStatus]` 필드는 제거됨 — 기간 필터가 대체

**공유 구조 (`ios-app/App/AppRootView.swift`)**

```
AppRootView
  @StateObject festivalFilterModel  (scope: "shared", AppGroup)
  └─ .environmentObject(festivalFilterModel)
       ├─ CalendarTabView   @EnvironmentObject
       └─ MapHomeView       @EnvironmentObject
```

- UserDefaults scope: `"festivalFilter.shared"` (이전 `"festivalFilter.calendar"`는 더 이상 사용 안 함)
- 필터 변경은 `FestivalFilterModel.update(_:)`로 처리하면 두 탭에 즉시 반영된다.

**APIClient (`ios-app/Core/Networking/APIClient.swift`)**

```swift
func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival]
```

- `upcomingWithinDays`는 `filter.dateRange.upcomingWithinDays`에서 계산한다.
- Worker `/api/festivals`는 `upcomingWithinDays: 0–365`를 지원한다.

**FilterSheetView 섹션 순서 (build 177 이후)**

1. 조회 기간 (`dateRangeSection`) — 프리셋 칩 6개 + "날짜 직접 선택" 칩 + DatePicker (custom 시)
2. 거리 반경
3. 지역
4. 카테고리

---

## 중요한 도메인 규칙

- 기존 공공 API 기반 "이벤트" 데이터는 현재 "축제" 도메인으로 취급한다.
- 새 "이벤트"는 식당/카페/상점/로컬 매장의 할인, 무료 제공, 리뷰 이벤트, 팝업, 한정 메뉴, 오픈 이벤트 등을 의미한다.
- 축제와 로컬 이벤트는 DB, API response, UI filter, map marker type에서 분리한다.
- 로컬 이벤트 D1 테이블은 `local_events`이고, 지도 item type은 `event`, marker type은 `local_event`이다.
- 로컬 이벤트는 기본적으로 `approved` 상태만 앱 API에 노출된다. `pending` 데이터가 많으면 앱에서는 비어 보일 수 있다.

## 현재 로컬 이벤트 수집 구조

현재 production provider는 `worker-backend/src/localEventDiscovery.ts`이고, 저장되는 `source`는 `naver_blog`다.

수집 흐름:

1. Naver Search Open API(블로그)로 지역·업종 키워드 조합을 검색해 이벤트 후보 글을 모은다.
2. 제목/본문에서 매장명과 혜택·기간 키워드를 뽑아낸다.
3. Kakao Local Keyword Search로 그 매장명을 조회해 실제 업체(`FD6`/`CE7`)와 좌표·주소를 매칭한다.
4. 혜택, 날짜, 매장명, 주소, 좌표, 원본 링크를 구조화한다.
5. 점수 기준을 만족하면 `approved`, 아니면 `pending`으로 저장한다.

중요:

- Naver Place feed HTML 스크래핑은 실패해 폐기했다. 다시 시도하지 않는다.
- Instagram 무단 HTML 크롤링, 로그인 세션 흉내, 봇 탐지 우회, 비공식 API 호출은 금지한다.
- 공개 API(Naver Search / Kakao Local)만 쓴다. 우회 헤더, 로그인 쿠키, 내부 API 역호출을 추가하지 않는다.
- 게시물 이미지 원본을 무단 저장하지 않는다. 가능하면 원본 링크 또는 허용된 이미지 URL만 참조한다.
- 댓글 작성자, 개인 계정, 개인정보는 저장하지 않는다.

주요 설정:

- `LOCAL_EVENT_PROVIDER_ENABLED`
- `LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE`
- `LOCAL_EVENT_SEARCH_MAX_QUERIES`
- `LOCAL_EVENT_BLOG_DISPLAY`
- `LOCAL_EVENT_MAX_KAKAO_LOOKUPS`
- `LOCAL_EVENT_KAKAO_RADIUS_METERS`
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`
- `KAKAO_REST_API_KEY`

## AKEI 무역박람회 수집 구조

산업/상업 박람회(코엑스·킨텍스·벡스코 등 전시컨벤션센터 행사)는 `worker-backend/src/akeiTradeExpoDiscovery.ts`가 AKEI(한국전시주최자협회) 게시판을 스크래핑해 전용 D1 테이블 `akei_trade_expos`에 저장한다. 이후 `AkeiTradeExpoFestivalProvider`(provider name `"akei-trade-expo"`)가 다른 discovery provider와 같은 청크 로테이션을 통해 `discovery_items`로 upsert한다 — `/api/festivals`는 `discovery_items`만 읽으므로, 스크래핑 직후가 아니라 청크 로테이션이 한 바퀴 돈 뒤에야 앱에 노출된다.

- `primary_category`는 `trade_expo`로 고정되며 LLM 태깅 대상이 아니다 (`llmTaggingSchema.ts`에 없음, `llmTaggingFallback.ts`의 결정론적 패턴도 `general_event`로만 보냄).
- 전시장 좌표는 `worker-backend/src/exhibitionVenues.ts`에 하드코딩된 이름→좌표 매핑(코엑스/킨텍스/벡스코/송도컨벤시아/aT센터/SETEC/EXCO)이다. 부분 문자열 매칭이라 새 항목 추가 시 키 길이 정렬 순서에 유의할 것. 좌표는 근사치이며 지도 서비스로 재검증이 필요하다는 경고 주석이 파일 상단에 있다.
- cron: 기존 `"15 * * * *"` 핸들러 안 `hour===5` 가드(city-festival의 `hour===4`와 별개)에서 매일 1회 실행.
- 수동 sync: `POST /admin/sync-akei-trade-expos` (다른 admin sync와 동일하게 `Authorization: Bearer $SYNC_ADMIN_TOKEN`).
- 알려진 제약: AKEI 게시판에서 실제로 수집하는 기간은 현재~3개월 범위다. `/api/festivals`의 `upcomingWithinDays`는 최대 365일까지 요청 가능하지만, 3개월보다 먼 미래의 무역박람회는 아직 AKEI에도 게시되지 않아 자연히 비어 보인다 — 버그 아님.

## 다가오는 행사 알림 (D-30 / D-7 / D-1)

예전에는 iOS `BGAppRefreshTask`가 깨어난 김에 8~30일 구간을 D-30으로 뭉뚱그려 보내고,
발송 이력을 기기 `UserDefaults`에만 남기고, 한 회차 3건·하루 10건을 넘는 대상은 버렸다.
지금은 Worker cron이 D1을 조회해 APNs로 직접 보낸다.

- **기기 등록** — `POST /api/notifications/register` (`notification_devices`, migration `0023`).
  앱이 실행할 때와 알림 설정이 바뀔 때마다 device id, APNs token, 토픽별 on/off,
  관심 지역, 카테고리, 방해 금지 시간을 통째로 올린다 (`ios-app/Core/Services/NotificationRegistrationService.swift`).
- **계획 (`planUpcomingNotifications`)** — 오늘(KST) + 30/7/1일에 **정확히** 시작하는 행사만 고른다.
  구간이 아니라 그 하루다. `discovery_items`(축제·공연·박람회)와 `local_events`(approved)를 함께 읽으므로
  로컬 이벤트도 같은 정책을 받는다. 기기 × 행사 조합을 `notification_sends`에 `INSERT OR IGNORE`로 쌓는다.
- **발송 (`dispatchPendingNotifications`)** — `sent_at IS NULL`인 행을 기기·종류별로 묶어 보낸다.
  한 기기에 같은 종류가 여러 건이면 묶음(digest) 알림 하나로 보내되 **대상 행 전부**를 발송 완료로 찍는다.
  한 회차 push 상한(`UPCOMING_NOTIFICATION_MAX_PUSHES`, 기본 40)은 subrequest 50건 한도 때문이고,
  못 보낸 행은 `sent_at IS NULL`로 남아 다음 회차에 그대로 다시 잡힌다 — 대상이 사라지지 않는다.
- **중복 방지 (migration `0025`)** — 기기 저장소에 의존하지 않고 층을 셋 쌓는다.
  1) `notification_devices (apns_environment, apns_token)` 부분 UNIQUE 인덱스 —
     같은 물리 기기가 여러 `device_id` 행으로 갈라지지 않는다. 같은 토큰으로 새 device가
     등록하면 `notificationRegistration.ts`가 옛 행의 토큰을 비우고 `notification_sends`
     이력을 새 device로 옮긴다(재설치해도 이미 보낸 알림이 다시 안 나간다).
  2) 발송은 `device_id`가 아니라 **(환경, 토큰)** 단위로 묶는다. DB가 잠시 지저분해도
     한 물리 기기에 한 번만 나간다.
  3) `notification_sends.claim_id` / `claimed_at` — 조건부 UPDATE로 선점한 회차만 보낸다.
     cron과 admin 호출이 겹쳐도 한쪽은 `skippedClaimed`로 빠진다. 선점은
     `CLAIM_TTL_MS`(1시간) 뒤 만료된다. APNs 응답을 못 받은 경우(`delivery_unknown`)는
     선점을 **일부러 유지**해 즉시 재시도하지 않는다 — 애플이 이미 받았을 수 있어서다.
  마지막 방어선으로 `apns-collapse-id`(`upcomingCollapseId`)를 붙여 두 건이 도착해도
  기기에서 하나로 합쳐진다. 여기에만 기대면 안 된다.
  PK `(device_id, event_id, notification_type)`는 그대로 계획 단계 중복을 막는다.
- **지역 매칭** — `worker-backend/src/regionMatch.ts` / `ios-app/Core/Storage/NotificationRegionKey.swift`.
  키는 `"서울"`(광역시도 전체) 또는 `"서울|중구"`(광역시도 + 시/군/구) 두 형태뿐이고 구분자는 `|`다.
  주소에서 광역시도와 시/군/구를 따로 뽑아 비교하므로 서울 중구와 부산 중구,
  강원 고성군과 경남 고성군이 갈린다. **관심 지역이 비면 전국 전체**이고, 반경으로 좁히지 않는다.
- **카테고리** — 비면 전체, 값이 있으면 그 카테고리만. 지역과 AND.
- **cron** — `"*/3 * * * *"` 안에서 `minute % 30 === 0`일 때 발송, `minute === 0`일 때 계획.
  수동 실행은 `POST /admin/run-upcoming-notifications` (`Authorization: Bearer $SYNC_ADMIN_TOKEN`).
- **쓰기 예산** — `notification_sends`는 인덱스 3개(PK autoindex + `_pending` + `_claim`)라
  계획 행 1건이 D1 쓰기 4행이다. 2026-08-28 실측으로 `discovery_items`의 미래 행사가
  3,712건 / 서로 다른 시작일 125일(하루 평균 29.7건, 최대 214건)이므로, D-30·D-7·D-1
  세 날짜를 합치면 기기 하나당 하루 계획 행이 대략 90건 = 360행 쓰기다.
  기기 100대면 하루 36,000행으로 무료 쓰기 예산(100,000행)의 3분의 1을 알림만으로 쓴다.
  기기 수가 늘면 계획 주기를 줄이거나 계획을 발송 직전으로 미루는 쪽을 먼저 검토한다.
  자세한 예산은 `docs/operations/worker-limits.md`.
- **딥링크** — push payload는 `eventKind` + `eventId`만 싣는다(4KB 한도, 낡은 사본 방지).
  앱이 `GET /api/festivals/:id` 또는 `GET /api/local-events/:id`로 상세를 받아 연다.
- **분리된 기능** — 저장한 축제 리마인더(`FestivalReminderService`)와 새 로컬 이벤트 발견 알림
  (`DiscoveryNotificationService`)은 여전히 기기 로컬 알림이다. 다가오는 행사 알림과 섞지 않는다.
- **secret** — `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`(.p8 전문)는 wrangler secret,
  `APNS_BUNDLE_ID`는 `wrangler.toml` var. 자세한 절차는 `worker-backend/README.md`.

## 요금·프로그램 정보 파이프라인

축제·공연·박람회 요금은 소스마다 필드가 달라 예전에는 축제는 `raw_payload.admissionFee`, 이벤트형 행은 `lowest_price_text`/`is_free` 컬럼으로 갈라져 있었고, `/api/festivals`는 전자만 읽어 이벤트형 행의 요금이 통째로 누락됐다. 지금은 세 층으로 정리돼 있다.

1. **정규화 (`worker-backend/src/feeNormalize.ts`)** — `normalizeFee()`가 어떤 소스의 요금 문구든 `{ feeType: free|paid|unknown, feeText }`로 만든다. 금액(`5,000원`)이 있으면 무조건 유료, `65세 이상 무료`처럼 특정 대상만 무료인 문구는 free로 치지 않는다. HTML 태그 제거·공백 정리·300자 상한 포함. `feeFreeFlag()`는 판별 불가를 `NULL`로 남겨 "유료"와 "모름"을 섞지 않는다.
2. **저장/조회 (`discoveryCache.ts`)** — `discoveryRow`가 축제·이벤트 양쪽 모두 `lowest_price_text` + `is_free`에 같은 모양으로 쓴다. 읽을 때는 `mapFestivalRow`가 `raw_payload.admissionFee` → `raw_payload.price` → `lowest_price_text` → `is_free===1 ? "무료"` 순으로 fallback한다. `mergeWithExistingEnrichment`가 `lowest_price_text`도 함께 보므로, 채워 넣은 요금이 다음 sync의 `raw_payload` 통째 덮어쓰기에 지워지지 않는다.
3. **Backfill (`worker-backend/src/feeBackfill.ts`)** — KOPIS `pcseguidance`와 TourAPI `usetimefestival`, 그리고 프로그램·출연진(KOPIS `dtguidance`/`prfcast`/`prfcrew`, TourAPI `playtime`/`program`/`subevent`)은 목록이 아니라 항목별 detail 응답에만 있어 sync 중 전부 호출할 수 없다. `runFeeBackfill()`이 한 회차에 `FEE_BACKFILL_MAX_ITEMS`(기본 45)건을 골라 **detail을 행마다 한 번만 열고 거기서 요금과 프로그램을 함께** 뽑는다 — 프로그램 때문에 추가로 fetch하지 않는다.

재조회 정책은 migration `0026` 이후 네 상태다. 예전에는 `fee_checked_at` 하나에 "값을 확보했다"와 "조회했지만 원본에 없다"를 섞어 찍어서, 나중에 공개된 정보를 영영 다시 보지 않았고 일시적 실패는 표식이 없어 같은 행만 매 회차 다시 잡혔다.

- **값 확보 완료** — `fee_filled_at` / `program_filled_at`. 그 필드는 두 번 다시 조회하지 않는다(둘은 따로 논다: 요금만 채워진 행은 프로그램만 다시 본다).
- **조회했지만 없음** — `detail_state='empty'` + `detail_retry_after`(행사가 가까울수록 짧은 backoff). 아직 공개되지 않은 정보가 올라오면 자연히 보강된다.
- **일시적 실패**(429·5xx·네트워크) — `detail_state`는 그대로 두고 `detail_retry_after`만 지수 backoff(5분 시작, 최대 6시간)로 미룬다. 영구 확정이 아니다.
- **영구 조회 불필요** — `detail_state='nodata'`. KOPIS `NODATA`·잘못된 source id·400, 그리고 이미 끝난 행사.

대상을 고른 직후 `detail_attempts`를 올리고 `detail_retry_after`를 15분(`CLAIM_TTL_MINUTES`) 뒤로 선점하며, 결과는 `FLUSH_CHUNK`(10건)마다 바로 쓴다. invocation이 CPU 10ms 초과로 조용히 죽어도 다음 회차가 같은 행에 갇히지 않고, 죽기 전까지의 작업이 통째로 사라지지 않는다.

- 마이그레이션: `0017_discovery_fee_checked_at.sql`(`fee_checked_at`) → `0024`(`program_checked_at`) → `0026_discovery_detail_backfill_state.sql`(`fee_filled_at` / `program_filled_at` / `detail_state` / `detail_retry_after` / `detail_attempts` + 대상 선정용 `idx_discovery_detail_backfill(source, detail_state, detail_retry_after)`). `fee_checked_at`·`program_checked_at`은 "마지막 시도 시각"으로만 남아 pipelineStats 대시보드가 읽는다 — 어떤 `WHERE` 선두에도 없으므로 그 둘을 받치던 인덱스는 `0027`이 지웠다.
- **subrequest 예산이 이 파이프라인의 상한이다.** 이 계정의 Worker는 invocation 하나당 외부 fetch 50건까지만 가능하고(51번째부터 `Too many subrequests by single Worker invocation`), backfill은 항목당 fetch 1건을 쓴다. D1 쿼리는 이 한도에 포함되지 않는다. 그래서 회차 상한이 45건이고 `POST /admin/backfill-fees`의 `maxItems`도 45로 제한한다. 이 값을 올리면 초과분이 통째로 실패한다.
- cron: `"*/5 * * * *"`의 분 슬롯(`floor(UTC분/5) % 4`)이 태깅·요금·좌표·사진을 나눠 갖는다. 한 invocation에 한 작업만 둬서 CPU 10ms와 subrequest 50건을 통째로 쓴다 — 요금은 슬롯 1, 하루 72회 × 45건. `"15 * * * *"`은 매시간 로컬 이벤트 sync(Naver/Kakao 호출 다수)와 같은 invocation이라 50건 예산을 나눠 쓰게 되어 옮겼다. 계정 한도 전반은 `docs/operations/worker-limits.md` 참고.
- 수동 실행: `POST /admin/backfill-fees?maxItems=<1..45>` (`Authorization: Bearer $SYNC_ADMIN_TOKEN`).
- 알려진 한계: `public-data-culture-festival`, `akei-trade-expo`, city 스크래핑 소스는 원본 데이터 자체에 요금 필드가 없어 `unknown`으로 남는다. 매핑할 값이 없는 것이지 버그가 아니다. 이 소스들은 애초에 detail backfill 대상(`kopis` / `tourapi` 계열)에 들어가지 않는다.

## D1 인덱스와 행 읽기·쓰기 예산

**2026-09-01부터 Cloudflare가 D1 무료 한도를 강제한다 — 하루 5,000,000행 읽기, 100,000행 쓰기.**
subrequest·CPU와 달리 **행 읽기·쓰기 초과는 예외를 던지지 않아서**, 인덱스가 빠진 쿼리 하나나
인덱스가 많은 테이블의 upsert 하나가 조용히 예산을 통째로 먹는다.

2026-08-28 실측(`wrangler d1 insights`, 1일 창):

- 읽기 상위 10개 합계 **1,350,540행** — 한도의 27%로 여유가 있다. 2026-08-18에는 5,049만행이었고,
  `0021`·`0027` 인덱스 작업과 pipelineStats 통합으로 내려왔다.
- 쓰기 상위 10개 합계 **549,917행** — **한도의 5.5배다. 여기는 아직 미해결이다.**
  `realtime_parking_status` upsert 하나가 310,842행(57%), `discovery_items` upsert가 158,788행.
  (이 창은 `0027` 적용 전후가 섞여 있고 인덱스 생성 자체의 40,530행도 포함한다 — 깨끗한
  재측정이 필요하다.)

읽기 쪽 규칙:

- 상관 서브쿼리(`NOT EXISTS (... WHERE aa.target_id = X)`)를 새로 쓰면 그 join 컬럼에
  인덱스가 있는지 먼저 확인한다. 없으면 후보 행마다 상대 테이블 전체를 훑는다.
  agent 쿼리는 `idx_agent_activity_target(target_id, agent_id, action)`이 받치고 있다.
- `ORDER BY`/`WHERE`에 쓰는 컬럼이 기존 복합 인덱스의 **선두**인지 본다.
  `(sync_type, started_at)`은 `sync_type` 없는 `started_at` 정렬을 못 받는다.
- 같은 테이블을 한 요청에서 여러 번 훑지 않는다. `pipelineStats.ts`는 스칼라 서브쿼리들을
  `SUM(CASE ...)` 단일 집계로 합쳐 `discovery_items` 훑기를 23회 → 7회, `local_events`를
  9회 → 5회로 줄였다.
- 로그성 테이블(`sync_runs`, `agent_activity`)은 보관 정리를 같이 넣는다.
  `pruneOldSyncRuns`가 `15 * * * *` cron의 UTC 6시 가드에서 30일치만 남긴다.

쓰기 쪽 규칙:

- **쓰기는 인덱스 개수만큼 증폭된다.** upsert 1건 = 본체 1행 + 그 테이블의 인덱스 수.
  `discovery_items`는 `0027` 이후 인덱스 11개(명시 9 + UNIQUE autoindex 2)라 upsert 1건이
  12행 쓰기다. 인덱스를 하나 더 만들면 그 테이블의 하루 쓰기가 upsert 건수만큼 통째로 늘어난다 —
  읽기 이득이 그만큼 되는지 먼저 따진다.
- 인덱스를 지우기 전에는 `EXPLAIN QUERY PLAN`으로 실제로 선택되지 않는지 확인한다.
  옵티마이저는 `ORDER BY`를 공짜로 만족시키는 인덱스를 더 선택적인 인덱스보다 앞세우므로,
  "있으면 쓰겠지" 싶은 인덱스가 실제로는 한 번도 안 골라지는 경우가 있다.
  `0027_d1_read_budget_indexes.sql`이 그렇게 소비자 없는 인덱스 5개를 지우고 축제 상세 조회용
  `(type, source_item_id, last_seen_at DESC)` 하나만 추가했다. 적용 확인:
  `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='discovery_items'` → 11.
- 주기적 upsert는 "바뀐 것만 쓰기"가 가장 큰 절감이다. `realtime_parking_status`는 3분마다
  최대 1000행을 통째로 덮어써서 단일 쿼리로 예산의 3배를 쓴다. 아직 손대지 않았다.

무엇이 얼마나 읽고 쓰는지는 이렇게 본다(상위 N개만 나온다):

```bash
pnpm -C worker-backend exec wrangler d1 insights parking-lot-navigator --sort-by reads --limit 10
pnpm -C worker-backend exec wrangler d1 insights parking-lot-navigator --sort-by writes --limit 10
```

인덱스 전후 실측과 유료 플랜으로 풀리는 항목은 `docs/operations/worker-limits.md` 참고.

## 자주 쓰는 명령

루트에서 실행:

```bash
pnpm install
pnpm -C worker-backend typecheck
pnpm -C worker-backend run deploy
pnpm --filter @parking/backend test
pnpm --filter @parking/backend preflight
```

Worker D1 마이그레이션:

```bash
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/<migration>.sql
```

로컬 이벤트 수동 sync:

```bash
curl -X POST \
  -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" \
  "https://parking-lot-navigator-api.parkingnav.workers.dev/admin/sync-local-events"
```

주의:

- Worker 코드만 바꾼 경우 iOS/Codemagic 빌드는 필요 없다. Worker deploy와 필요한 D1 migration/sync가 핵심이다.
- Swift/iOS UI를 바꾼 경우에만 Codemagic 또는 Xcode 빌드를 고려한다.
- D1 schema를 바꾸면 반드시 새 migration을 추가한다. 기존 migration을 임의 수정하지 않는다.

## API 기준

주요 endpoint:

앱이 쓰는 것:

- `GET /api/festivals`, `GET /api/festivals/:id`
- `GET /api/performances`
- `GET /api/local-events`, `GET /api/local-events/:id`
- `GET /api/map/items?type=festival|event|all`
- `POST /api/local-events/report`
- `POST /api/notifications/register`

관리용 (`Authorization: Bearer $SYNC_ADMIN_TOKEN`):

- `POST /api/admin/local-events`, `PATCH /api/admin/local-events/:id`, `PATCH /api/admin/local-events/:id/status`
- `POST /admin/sync-local-events`, `POST /admin/sync-city-festivals`, `POST /admin/sync-akei-trade-expos`, `POST /admin/sync-discovery`
- `POST /admin/backfill-fees`, `POST /admin/backfill-images` (`maxItems` 1..45), `POST /admin/backfill-geocodes` (`maxLookups` 1..40)
- `POST /admin/run-upcoming-notifications`, `POST /admin/run-tagging`, `POST /admin/run-head-review`
- `GET /discover/pipeline-stats` (파이프라인 대시보드), `GET /discover/providers/health`

앱에서 이벤트가 안 보일 때 먼저 확인할 것:

1. Worker가 최신 master로 deploy 되었는가.
2. 필요한 D1 migration이 remote에 적용되었는가.
3. `/admin/sync-local-events`가 성공했는가.
4. `local_events.status`가 `approved`인가.
5. 좌표가 `0`이거나 `NULL`이 아닌가.
6. 앱 요청의 `lat/lng/radiusMeters` 범위 안에 이벤트가 있는가.
7. Naver/Kakao API key가 Worker secret/vars에 설정되어 있는가.

## 개발 원칙

- 작업 전 `git status --short`로 현재 변경 상태를 확인한다.
- 사용자가 만들었을 수 있는 변경을 되돌리지 않는다.
- 검색은 우선 `rg` 또는 `rg --files`를 사용한다.
- 불필요한 리팩터링을 피하고 요청 범위에 맞게 수정한다.
- 타입 변경은 `shared-types`, Worker schema, backend route schema, D1 migration이 서로 맞는지 확인한다.
- 수집/동기화 로직은 개별 provider 실패가 전체 sync를 죽이지 않도록 best-effort로 처리한다.
- 비밀키, 토큰, `.env`, `.dev.vars`, xcconfig 실제값은 커밋하지 않는다.

## 검증 기준

Worker 변경 시 최소:

```bash
pnpm -C worker-backend typecheck
```

Backend provider나 shared backend logic 변경 시:

```bash
pnpm --filter @parking/backend test
pnpm --filter @parking/backend preflight
```

iOS 변경 시:

- XcodeGen 프로젝트 파일 생성 여부 확인.
- 가능한 경우 Xcode/Codemagic 빌드 확인.
- 앱 빌드 번호를 올려야 하는 배포 작업인지 구분한다.

## Git 운영

- 사용자가 커밋/푸시를 요청하면 `master`에 커밋 후 `git push origin master`까지 진행한다.
- 커밋 전 타입체크/테스트 결과를 확인한다.
- 커밋 메시지는 구체적으로 쓴다. 예: `Expand local event discovery nationwide`.
- `git reset --hard`, `git checkout --`, 강제 push 같은 파괴적 명령은 사용자가 명시적으로 요청한 경우에만 사용한다.

## 응답 방식

- 사용자가 "해야 할 일"을 물으면 앱 빌드, Worker deploy, D1 migration, sync 중 무엇이 필요한지 명확히 구분한다.
- 작업 결과는 변경 파일, 검증 명령, 커밋 해시, 다음 배포/운영 단계 위주로 짧게 보고한다.
- 문제가 남아 있으면 숨기지 말고 원인과 다음 확인 지점을 구체적으로 말한다.

## 응답 마무리 형식

작업 완료 응답 끝에 반드시 아래 섹션을 ## 헤딩+이모지로 추가한다 (번호/볼드 금지).

- **📋 진행 요약**: 이번 턴에 한 일 (변경 파일·결과 등 구체적으로)
- **🧭 다음 추천 작업**: 후속 없으면 섹션 전체 생략
- **🚀 Git 명령**: git 변경 없으면 생략. 한 줄 `&&` 체인으로.
- **📱 iOS/Codemagic 빌드 필요 여부**: 항상 한 줄 "iOS 빌드 필요: 예/아니오"
  - 예: ios-app/ 내 Swift·asset·xcconfig·project.yml·Info.plist 변경 시. 이때 ios-app/project.yml CURRENT_PROJECT_VERSION +1 Edit 수행 후 새 값 안내, git add에 포함.
  - 아니오: worker-backend·backend·shared-types·docs·루트 md/json 등 변경 시.
