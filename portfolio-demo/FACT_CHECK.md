# 사실 확인 — 영상의 모든 주장과 근거

기준 시점 2026-09-08, 커밋 `a7d7b98` 기준 저장소 상태에서 확인했다.
아래 경로는 전부 `test -e`로 존재를 확인했고, 숫자는 실제로 명령을 돌려 측정한 값이다.

## 1. 서비스 정체성 (S1, S10)

| 영상의 주장 | 근거 |
|---|---|
| 앱 이름 `이벤트다` | `ios-app/Resources/AppInfo.plist` — `CFBundleDisplayName` |
| 개인 프로젝트 | `git log --format=%an` 결과가 `sangmin` / `sangminbis9` (동일인) 뿐 |
| GitHub `github.com/sangminbis9/parking-lot-navigator` | `git remote -v` |
| 앱 아이콘 | `ios-app/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` |

## 2. 앱 기능 (S2–S5)

| 영상의 주장 | 근거 파일 |
|---|---|
| 지도에 축제·공연·박람회·로컬 이벤트를 함께 표시 | `ios-app/Features/Map/MapHomeView.swift` (`discoverSources`) |
| 카테고리별 핀 | `ios-app/Features/Map/MapPinRenderer.swift`, `design/map-pins/` |
| 공연 레이어 토글 | `ios-app/Features/Map/MapHomeViewModel.swift:20` `showsPerformanceLayer`, `:182` `setPerformanceLayerVisible` |
| 중복 핀 제거 | `MapHomeView.swift` `seenFestivalIds` / `seenEventIds` dedup |
| 검색 목적지 기준 조회 | `ios-app/Features/Map/MapSearchOverlay.swift` |
| 행사 상세: 기간·장소·요금·프로그램 | `ios-app/Features/ParkingResults/ParkingResultsView.swift` |
| 요금을 무료/유료/확인 불가로 정규화 | `worker-backend/src/feeNormalize.ts` — `normalizeFee()`가 `feeType: free\|paid\|unknown` 반환 |
| 프로그램은 원본에 있는 문장만 | `worker-backend/src/programCrawl.ts` — `isGrounded()` |
| 오류 신고, 신고자 식별 정보 미저장 | `ios-app/Features/ParkingResults/EventReportSheet.swift`, `worker-backend` `eventReportSchema` (기기 id·이메일 등을 파싱 단계에서 버림), migration `0030` |
| 캘린더 월 달력 + 날짜별 목록 + 근처 공연 | `ios-app/Features/Calendar/CalendarTabView.swift` |
| 기간·반경·지역·카테고리 필터를 지도 탭과 공유 | `ios-app/Features/Calendar/FilterSheetView.swift`, `ios-app/Core/Storage/FestivalFilterStore.swift` (scope `festivalFilter.shared`) |
| D-30 / D-7 / D-1 푸시 알림 | `worker-backend/src/upcomingNotifications.ts` (`planUpcomingNotifications` / `dispatchPendingNotifications`), migration `0029` |
| 행사 주변 주차장 거리순 | `ios-app/Features/ParkingResults/NearbyParkingMapView.swift` |
| 서울시 실시간 잔여 면수 | `backend/src/providers/SeoulRealtimeParkingProvider.ts`, D1 `realtime_parking_status` |
| 길안내 앱 연결 | `ios-app/Integrations/NavigationBridge/KakaoNavigationService.swift` |

## 3. iOS 플랫폼 기능 (S6)

| 영상의 주장 | 근거 |
|---|---|
| 홈 화면 위젯 Small · Medium · Large | `ios-app/Integrations/WidgetKit/UpcomingFestivalsWidget.swift:88` — `.supportedFamilies([.systemSmall, .systemMedium, .systemLarge])` |
| 공유 시트 확장 | `ios-app/Integrations/ShareExtension/ShareViewController.swift`, `project.yml` 타깃 `ParkingShareExtension` |
| Siri 단축어 (App Intents) | `ios-app/Integrations/AppIntents/ParkingAppShortcuts.swift` (`AppShortcut` 2개), `FindParkingNearDestinationIntent.swift`, `NavigateRecentDestinationIntent.swift` |
| 푸시 알림 · 딥링크 | `ios-app/Integrations/DeepLinks/DeepLinkRouter.swift`, `ios-app/Core/Services/NotificationRegistrationService.swift` |

## 4. 데이터 파이프라인 (S7)

**공개 데이터 소스 9개** — `worker-backend/src/discoverySchedule.ts`의 `DISCOVERY_PROVIDER_CHUNKS`에 등록된 청크와 1:1 대응한다:
`tourapi-festival`, `tourapi-area-festival`, `tourapi-keyword-festival`, `public-data-culture-festival`,
`seoul-culture-event`, `culture-portal`, `kopis`, `city-scraped`, `akei-trade-expo`.
로컬 매장 이벤트의 자동 수집 파이프라인은 2026-09-16 폐기했다. 기존 수집 핀은 D1과 정적 스냅샷에 유지하며, 신규 로컬 이벤트는 인증된 사장님 등록 경로로만 받는다.

| 영상의 주장 | 근거 |
|---|---|
| 정규화 | `worker-backend/src/feeNormalize.ts`, `cityFestivalNormalize.ts` |
| 중복 병합 (연도·회차·주최 접두어 제거) | `worker-backend/src/discoveryCache.ts:249` `dedupeFestivals()` |
| Workers AI Llama 3.3 70B | `worker-backend/wrangler.toml:61` — `TAGGING_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"` |
| 12개 축제 카테고리 | `worker-backend/src/llmTaggingSchema.ts` `FESTIVAL_PRIMARY_CATEGORIES` 12개 |
| 실패 시 규칙 기반 fallback + 7일 후 재시도 | `worker-backend/src/llmTaggingFallback.ts`, `tagging_version = -1` + 7일 backoff, `tests/taggingFallbackBackoff.test.ts` |
| 요금·이미지·좌표·프로그램 보강 배치 | `worker-backend/src/feeBackfill.ts`, `programCrawl.ts`, `/admin/backfill-images`, `/admin/backfill-geocodes` |
| 크롤 프로그램은 원문 대조로 검증 | `programCrawl.ts` — `isGrounded()` |
| D1 테이블 `discovery_items` · `local_events` · `realtime_parking_status` | `worker-backend/migrations/` |
| 마이그레이션 0001 – 0031 | `ls worker-backend/migrations/*.sql` → 31개 |
| API `/api/festivals` `/api/performances` `/api/local-events` `/api/map/items` | `worker-backend/src/index.ts` |

## 5. 엔지니어링 · 제약 (S8)

| 영상의 주장 | 근거 |
|---|---|
| invocation당 외부 요청 50건 한도 | `docs/operations/worker-limits.md`, `CLAUDE.md` — 51번째부터 `Too many subrequests by single Worker invocation` |
| 배치 상한 45건 | `worker-backend/src/feeBackfill.ts` `FEE_BACKFILL_MAX_ITEMS` 기본 45, `/admin/backfill-fees?maxItems=1..45` |
| cron 슬롯을 나눠 회차마다 한 작업 | `worker-backend/src/jobs.ts` — `"*/5 * * * *"` epoch 5분 칸 5분할 |
| D1 하루 읽기 500만 · 쓰기 10만 행 | `docs/operations/worker-limits.md` (Cloudflare 무료 한도, 2026-09-01부터 강제) |
| 초과해도 예외가 나지 않는다 | 같은 문서 |
| 부분 인덱스로 대상 선정 스캔 축소 | `worker-backend/migrations/0031_d1_backfill_scan_indexes.sql` |
| 값이 바뀐 행만 쓰는 조건부 upsert | `worker-backend/tests/discoveryConditionalWrite.test.ts`, `realtimeConditionalWrite.test.ts` |
| 인덱스 정리 (0027 · 0028) | `0027_d1_read_budget_indexes.sql`, `0028_realtime_parking_write_budget.sql` |
| HTML 파싱 회차가 통째로 죽어 결과가 안 남았다 | `CLAUDE.md` 프로그램 크롤 절 — 2026-09-02 04:10 UTC 슬롯 `Exceeded CPU Limit` 실측 |
| 회차 4건 · 2건마다 즉시 저장 | `worker-backend/src/programCrawl.ts` — `PROGRAM_CRAWL_MAX_ITEMS` 기본 4, `FLUSH_CHUNK` 2 |
| 화면에 확대한 SQL | `worker-backend/migrations/0031_d1_backfill_scan_indexes.sql` 원문과 문자 단위로 동일 (주석 문구 포함) |

스택 12개는 모두 실제 사용을 확인했다: SwiftUI / WidgetKit / App Intents (`ios-app/`),
Cloudflare Workers · Hono · D1 · Queues · Workers AI (`worker-backend/package.json`, `wrangler.toml`),
APNs (`upcomingNotifications.ts` + `APNS_*` secret), TypeScript, Vitest (`*.test.ts`), Zod (스키마 검증).

## 6. 숫자 (S9) — 측정 명령과 결과

| 영상의 숫자 | 측정 방법 | 결과 |
|---|---|---|
| iOS Swift 파일 98개 | `find ios-app -name '*.swift' \| wc -l` | 98 |
| 약 23,000줄 | `find ios-app -name '*.swift' -exec cat {} + \| wc -l` | 23,090 |
| Worker TypeScript 파일 76개 | `find worker-backend/src -name '*.ts' \| wc -l` | 76 |
| 약 19,600줄 | 같은 방식 | 19,634 |
| D1 마이그레이션 31개 | `ls worker-backend/migrations/*.sql \| wc -l` | 31 (0001 – 0031) |
| 자동화 테스트 382개 / 59개 파일 전부 통과 | worker `vitest` → `Test Files 36 passed (36), Tests 308 passed (308)` · backend `vitest` → `Test Files 23 passed (23), Tests 74 passed (74)` | 59파일 / 382테스트 전부 통과 |

영상에는 `저장소 기준 집계 · 2026-09-08 · 실제 사용자 대상 운영 지표가 아니다`라는 문구를
숫자 바로 아래에 함께 띄운다.

## 7. 의도적으로 넣지 않은 것

사실로 확인할 수 없거나, 확인은 되지만 오해를 부를 수 있어 뺐다.

| 뺀 것 | 이유 |
|---|---|
| 실제 앱 실행 화면 캡처 | 저장소에 스크린샷이 없고 WSL에 Xcode가 없어 캡처 불가. 대신 구성도 + `실행 화면 캡처 아님` 배지 |
| 사용자 수 · 다운로드 수 · 리텐션 | 앱이 출시되지 않았고 어떤 사용자 지표도 없다 |
| "운영 중인 서비스" 표현 | Worker와 D1은 배포돼 있지만 App Store 출시 전이다. "개인 프로젝트"로만 적었다 |
| 수집된 행사 건수 (예: "3,712건") | `CLAUDE.md`에 2026-08-28 실측이 남아 있지만 매일 변하는 값이라 영상에 박제하지 않았다 |
| 응답 시간 · 처리량 같은 성능 수치 | 측정한 적이 없다 |
| D1 읽기/쓰기 감축 비율 (예: "쓰기 82% 감소") | 문서에 실측이 있으나 측정 창이 24시간을 온전히 채우지 않은 구간이 섞여 있어 단정하지 않았다. 대신 "무엇을 왜 바꿨는지"만 말한다 |
| "CPU 10ms 한도" 표현 | `docs/operations/worker-limits.md`의 실측과 어긋난다. "invocation 리소스 한도"로 적고, 조용히 죽는 증상만 설명했다 |
| 팀·협업 표현 | 개인 프로젝트다 |
| Instagram 등 비공개 소스 | 수집하지 않으며 정책상 금지다. 영상에서도 공개 API/공개 페이지만 말한다 |
