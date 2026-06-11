# 프로젝트 상태

마지막 업데이트: 2026-06-11

## 프로젝트

- 앱: Parking_Lot_Navigator
- 저장소: `sangminbis9/parking-lot-navigator`
- 메인 브랜치: `master`
- 로컬 경로: `C:\Users\sangm\OneDrive\문서\Coding\parking-lot-navigator`
- 프로덕션 Worker: `https://parking-lot-navigator-api.parkingnav.workers.dev`

## 구성 요소

- `backend`: TypeScript + Fastify API/provider/랭킹 로직.
- `worker-backend`: Cloudflare Workers + Hono 프로덕션 API.
- `ios-app`: Kakao Maps 를 사용하는 SwiftUI 앱.
- `shared-types`: 공유 TypeScript API/도메인 타입.

## 런타임

- 프로덕션 API 는 Cloudflare Worker 백엔드이다.
- Railway 는 더 이상 사용하지 않는다.
- Worker D1 바인딩: `DB`
- D1 데이터베이스: `parking-lot-navigator`
- D1 데이터베이스 id: `31c04846-57d5-4e38-82b6-2d7b3a0dfbee`
- Worker cron: 실시간 주차 캐시 sync 를 위해 5분마다.

## 시크릿

repo 문서나 채팅 요약에 실제 API 키나 admin 토큰을 적지 않는다.

필요한 프로덕션 secret 이름:

- `KAKAO_REST_API_KEY`
- `KAKAO_CLIENT_SECRET` (Kakao Login client secret, OAuth)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (Naver Login + 블로그/로컬 검색)
- `SEOUL_OPEN_DATA_KEY`
- `SEOUL_SEONGDONG_IOT_KEY` 별도 사용 시; 아니면 서울 키 fallback 존재.
- `SEOUL_HANGANG_PARKING_KEY` 별도 사용 시; 아니면 서울 키 fallback 존재.
- `PUBLIC_DATA_SERVICE_KEY`
- `CULTURE_PORTAL_API_KEY` 선택; 해당하는 경우 문화포털용으로 `PUBLIC_DATA_SERVICE_KEY` 로 폴백.
- `KOPIS_API_KEY`
- `KCISA_428_API_KEY`
- `KCISA_196_API_KEY`
- `SYNC_ADMIN_TOKEN`
- `MERCHANT_SESSION_SECRET` (머천트 세션 쿠키용 HS256 JWT 서명 키)
- `TOSS_SECRET_KEY` (Toss Payments 위젯 secret key; `TOSS_CLIENT_KEY` 는 `wrangler.toml` vars 에 위치)
- Cloudflare/GitHub Actions deploy secret

deploy CI 는 `wrangler versions secret put` 을 사용해 여러 secret 을 하나의 새 Worker 버전에 stage 한 뒤 최종 `wrangler deploy` 단계에서 함께 적용한다.

## 현재 Provider 구조

제품은 이제 축제/이벤트 발견 우선이며, 주차는 선택한 목적지 방문을 위한 실용적 보조 레이어이다.

메인 발견 흐름:

1. 사용자가 로컬 축제/이벤트 콘텐츠를 중심으로 앱을 연다.
2. 앱은 축제/이벤트 레이어, 발견 목록, 검색, 상세, 인앱 지도 포커스를 보여준다.
3. 사용자가 이벤트/축제를 고르면, 앱은 그것을 목적지로 설정할 수 있다.
4. 주변 주차 추천과 실시간 주차가 그 목적지 방문을 돕는다.

주차 추천 흐름:

1. 사용자가 목적지를 검색한다.
2. 앱이 목적지 주변 주차 API 를 호출한다.
3. provider 들이 후보를 병합/중복제거/랭킹한다.
4. 목적지 자체가 주차장일 때 목적지 주차 후보는 계속 우선되어야 한다.

실시간 지도 레이어:

- iOS 실시간 토글은 기본값이 꺼짐이다.
- 켜면 앱이 Worker/D1 캐시에서 전국 실시간 핀/클러스터를 로드한다.
- 실시간 캐시는 D1 테이블 `realtime_parking_status` 가 뒷받침한다.
- 실시간 캐시 sync 는 5분마다 실행되도록 의도되어 있다.

이벤트/축제 발견 레이어:

- 지도는 "이벤트" 라는 사용자 노출 토글 하나를 노출한다.
- 그 단일 토글은 기존 공공 데이터, 서울 열린데이터, TourAPI, 문화포털, KOPIS, KCISA provider 의 모든 축제/이벤트 핀을 보여준다.
- API/source 별 스위치는 지도 UI 에 표시하지 않는다.
- 이벤트 탭은 내부적으로 카테고리/source 인식 필터링을 여전히 지원하지만, 사용자 노출 필터는 이벤트 종류 중심이다.
- 이벤트 탭은 이벤트 탭이 선택될 때만 발견 데이터를 로드한다.
- 이벤트 탭을 떠나면 진행 중인 로딩을 취소하고 정리를 잠깐 미뤄 탭 전환이 반응성을 유지하게 한다.
- 이벤트 탭은 처음에 20개 행을 렌더링하고, 사용자가 바닥까지 스크롤하면 20개를 더 로드한다.
- 지도 이벤트 핀과 이벤트 탭 행은 이제 동일한 이벤트 상세 + 주변 주차 추천 화면을 연다.
- 이벤트 추천 화면은 랭킹 전에 일반 주변 주차와 실시간 주차를 병합한다.
- 실시간 주차가 실패해도 일반 주변 주차가 성공하면 추천 화면은 여전히 동작한다.
- 이벤트 상세 화면은 현재 가용한 모든 필드를 보여준다: 설명, 날짜, 장소, 주소, 가격, 지역, source, source URL, 갱신 타임스탬프, 이미지, 태그.
- 일부 상위 API 는 긴 설명이 빈약하거나 없다. 설명이 없을 때 앱은 제목, 날짜, 장소, 종류, 가격, source 로부터 생성한 요약을 표시한다.

주요 주차 provider:

- 서울 실시간: `GetParkingInfo`
- 서울 메타데이터: `GetParkInfo`
- 서울 보조:
  - 성동 IoT 공유 주차 provider
  - `TbParkingInfoView` 를 사용하는 한강 주차 provider
- 대전 실시간
- 대구 수성 실시간
- KAC 공항 실시간
- 인천공항 실시간
- 전국 정적 D1 데이터
- TS Korea
- Kakao Local PK6 fallback

주요 발견 provider:

- data.go.kr / KTO TourAPI 를 통한 TourAPI 축제 provider.
- data.go.kr 을 통한 전국 문화축제 표준 데이터.
- 서울 열린데이터 문화행사.
- 문화포털 "한눈에보는문화정보" / 공공 문화정보.
- KOPIS 공연 목록.
- KCISA Culture API id 428, source id `kcisa_428`.
- KCISA Culture API id 196, source id `kcisa_196`.

## 로컬 이벤트 (축제와 별개 도메인)

- 로컬 이벤트는 D1 테이블 `local_events` 에 있다. 식당/카페/상점 할인, 무료 제공, 팝업, 한정 메뉴, 오픈 이벤트를 나타낸다.
- 프로덕션 발견은 Naver Open API + Kakao Local Keyword 를 사용한다:
  1. 85개 지역 중심에 걸쳐 21개 이벤트형 키워드(카페·맛집·식당·디저트·베이커리·팝업 변형)로 Naver 블로그 / 카페 글 / 뉴스 검색.
  2. Kakao Local Keyword Search 가 각 게시물의 매장명을 place id, 주소, 좌표에 매칭한다.
  3. 매칭은 Kakao place id 별로 중복 제거된다. `end_date` 가 없는 이벤트도 점수가 임계값을 넘으면 approved 될 수 있다.
- Worker subrequest 예산은 호출당 분배된다: `LOCAL_EVENT_SEARCH_MAX_QUERIES = 17`, `LOCAL_EVENT_MAX_KAKAO_LOOKUPS = 30` 으로 무료 등급의 50 subrequest 상한 아래를 유지한다.
- 자동 승인 임계값: `LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE = "0.75"`.
- 상태 값: `pending`, `pending_payment`, `approved`, `rejected`, `expired`.
- 공개 API (`/api/local-events`) 는 `status = 'approved'` 이고 `(is_sponsored = 0 OR paid_until > now)` 인 행만 제공한다. pending 및 미결제 머천트 이벤트는 제외된다.

### Agent Office (LLM head 리뷰)

- `agent_activity` D1 테이블은 인앱 Agent Office 화면을 위해 scout/orion/echo agent 행동을 로깅한다.
- head agent `orion` 은 Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) 에서 실행되며, 후보마다 한국어 근거와 함께 `approve / pending / reject` 판정을 낸다.
- Workers AI 는 `wrangler.toml` 에 `[ai] binding = "AI"` 로 바인딩된다. 외부 API 키는 필요 없다.
- sync 호출은 `scout.found` 를 로깅하고, head 리뷰 호출은 `orion.validate` 를 로깅한다(판정이 `approve` 면 `echo.post` 도).
- `GET /agent-office/activity` 는 최근 활동 피드를 노출한다. iOS AgentOffice scene 이 실시간 LLM 말풍선을 위해 이를 읽는다.

## 머천트 / 유료 이벤트 등록

- 머천트 가입 랜딩: `https://parking-lot-navigator-api.parkingnav.workers.dev/merchant`.
- 인증: Naver Login OAuth 와 Kakao Login OAuth. 세션은 HttpOnly Secure SameSite=Lax 쿠키 안의 HS256 JWT 이며 `MERCHANT_SESSION_SECRET` 으로 서명된다. CSRF state 쿠키가 OAuth 콜백을 보호한다.
- 이벤트 폼: 제목, 설명, 혜택, 이벤트 종류, 매장명, 주소(Kakao 지오코딩, 키워드 폴백), 시작/종료일, 이미지(R2 버킷 `merchant-images` 에 직접 업로드, 최대 5 MB jpeg/png/webp, 업로드 전 클라이언트에서 최대 1600px / 품질 0.85 로 압축).
- R2 이미지 제공: `GET /merchant/images/:key` 가 immutable 캐시 헤더로 R2 에서 스트리밍한다.
- 가격: 이벤트당 `EVENT_PRICE_KRW = 10000`, `EVENT_DURATION_MONTHS = 3`. `paid_until = startDate + 3 months`.
- 결제 통합: Toss Payments **결제위젯 v2** (`https://js.tosspayments.com/v2/standard`).
  - 테스트 키(현재): `wrangler.toml` 의 `TOSS_CLIENT_KEY = test_gck_docs_...`, wrangler secret 의 `TOSS_SECRET_KEY = test_gsk_docs_...`.
  - 프로덕션 키는 "API 개별 연동 키" 가 아니라 **결제위젯 연동 키** 계열(`live_gck_...` / `live_gsk_...`)이어야 한다.
- 결제 흐름: 폼 제출 시 `pending_payment` 행 생성 → `/merchant/event/:id/pay` 에서 Toss 위젯 렌더링 → 성공 콜백이 `/merchant/event/:id/payment/success` 에 도달, orderId/금액 검증, `confirmTossPayment` 호출, 이후 `markEventApproved` 가 상태를 `approved` 로 전환.
- iOS link-out: 설정 화면에 "내 가게 이벤트 등록" 카드가 있어 Safari 로 `/merchant` 를 연다 (App Store 가이드라인 3.1.3(b) B2B 예외로 Apple IAP 회피 — 인앱 구매 프롬프트 없음).
- 머천트 웹 페이지 스타일: 앱 기본 테마(허니 옐로)의 `FestivalDesign` 팔레트를 CSS 변수(`--festival-*`)로 옮겨 적용 (`worker-backend/src/merchant/pages.ts` 의 `baseStyle`). 네이버/카카오 로그인 버튼은 각 브랜드 색 유지.
- 약관/정책 동의: 랜딩에는 "시작하면 동의 간주" 안내, 이벤트 등록 폼에는 **필수 동의 체크박스**(`agree_legal`, 클라이언트 `required` + `POST /merchant/event/new` 서버 검증). 이용약관/개인정보처리방침/환불·취소 정책은 기존 `/legal/*` 라우트를 네이티브 `<dialog>` + iframe 팝업으로 재사용한다 (`showModal` 미지원 브라우저는 새 탭 폴백).

## Cloudflare 리소스

- D1 바인딩: `DB` (`parking-lot-navigator`, id `31c04846-57d5-4e38-82b6-2d7b3a0dfbee`).
- R2 바인딩: `MERCHANT_IMAGES` (버킷 `merchant-images`).
- Worker 트리거: cron `* * * * *` (실시간 주차), `0 * * * *` (시간당 유지보수), `15 * * * *` (로컬 이벤트 sync 청크), `30 */3 * * *` (head agent 리뷰).
- Workers AI 바인딩: `AI` (`orion` head agent 가 사용).

## 현재 iOS UX/브랜드

- 이벤트/축제 경험이 주된 화면이며, 실시간 주차는 토글/보조 레이어로 남는다.
- 티켓 모양의 축제 마스코트가 앱의 메인 캐릭터 방향이다.
- 마스코트 에셋은 `ios-app/Resources/Assets.xcassets` 에 있다:
  - `FestivalMascotMain`
  - `FestivalMascotIcon`
  - `FestivalMascotJump`
  - `FestivalMascotGuide`
  - `FestivalMascotNight`
  - `FestivalMascotConcept`
- SwiftUI 지도/발견 UI 는 이제 검색, 목록, 빈 상태, 상세 이미지, 도우미/팁 화면 전반에서 마스코트와 더 따뜻한 축제 팔레트를 사용한다.
- Figma 리디자인 참조: `Festival-Event-App-Redesign`.
- 테마 시스템: 설정 → 테마에서 6종 선택 — 허니 옐로(기본)/피치 코랄/민트 그린/스카이 블루/라벤더/**크레파스**. `FestivalTheme`(enum, UserDefaults `festivalTheme` 영속) + `FestivalThemePalette`(12색) + `FestivalDesign`(static 토큰 accessor) 구조이며, 컴포넌트는 색/radius/도형/폰트를 모두 토큰으로 참조한다.
- 크레파스 테마는 `isHandDrawn` 분기로 **룩 전체**가 손그림으로 바뀐다: ① 번들된 개구쟁이체(Gaegu, OFL — `Resources/Fonts/`, `Font.festival`/`FestivalDesign.uiFont` 토큰 264곳) ② 카드 왁스 이중 스트로크 + 오프셋 스티커 그림자(`FestivalCardBackground`) ③ 컨트롤/칩 손그림 외곽선(`FestivalDesign.controlShape`/`chipShape`, `RoughRoundedRectangle`) ④ 종이 알갱이 + 사선 크레용 해칭 질감(`PaperTexture`, 루트 `paperGrainOverlay()`) ⑤ 네비/탭바·지도 마커 라벨 손글씨. 다른 테마는 비분기 경로라 시각적 영향이 없다. 핵심 파일: `Core/DesignSystem/FestivalDesign.swift`, `Core/DesignSystem/HandDrawnStyle.swift`.
- 탭 바 순서는 `지도 → 이벤트 → 즐겨찾기 → 캘린더 → 사무실 → 설정` (6개 탭). 캘린더 탭은 테마가 적용된 월간 그리드이며 아래에 인라인 어젠다가 있다: 날짜를 선택하면 그날의 축제를 그 자리에서 목록으로 보여주고(상세 시트 없음), 축제별 즐겨찾기 저장(별표)과 시작 전 로컬 알림(종) 토글, 스와이프 월 이동, "오늘 / 이번 주말" 프리셋을 제공한다.
- 캘린더와 위젯이 사용하는 공유 필터 축: 지역(시·도), 거리 반경(10/20/50km/무제한), 태그/장르, 진행 상태(진행중/예정). 필터 상태는 App Group `UserDefaults` 에 영속되어 두 화면이 함께 사용한다.

## 캘린더 + 위젯 아키텍처

- 캘린더 탭은 `/api/festivals` (별칭 `/discover/festivals`) 응답을 `upcomingWithinDays=90` 으로 받아 `[Date: [Festival]]` 버킷으로 정리하고, 날짜 셀에 dot 인디케이터(진행 중 → teal, 예정 → lantern)를 표시한다.
- iOS 홈 화면 **Medium 위젯** `UpcomingFestivalsWidget` 가 다가오는 축제 3개를 카드 형태로 노출한다. 위젯은 네트워크를 직접 호출하지 않고 App Group container 의 `widget_festivals.json` 캐시만 읽는다.
- `FestivalSyncService` (앱 본체) 가 cold start, foreground 진입, 필터 변경 시 `/api/festivals` 를 호출 → 필터 적용 → 상위 ~20개를 `SharedFestivalCache` 에 저장 → `WidgetCenter.shared.reloadTimelines(ofKind: "UpcomingFestivalsWidget")` 를 호출한다.
- App Group ID 는 기존 메인 앱이 쓰던 `group.com.sangminbis9.ParkingLotNavigator` 를 재사용한다. 위젯 entitlements 도 동일한 그룹을 참조한다.
- 위젯 extension Bundle ID: `com.sangminbis9.ParkingLotNavigator.UpcomingFestivalsWidget` (project.yml 에서 `$(APP_BUNDLE_ID).UpcomingFestivalsWidget` 으로 inline 파생).
- 위젯 target sources: `Integrations/WidgetKit`, `Core/Models`, `Core/Storage`, `Core/DesignSystem` (위젯 target 에는 `Core/Logging` 미포함 — `SharedFestivalCache` 는 silent `try?` 실패).
- iOS deployment target 16.0 호환을 위해 `containerBackground(_:for: .widget)` 은 iOS 17+ 분기로 처리.
- EventKit 연동(축제 → 기본 캘린더 추가)은 v1.1 로 deferred. v1 에서는 NSCalendarsUsageDescription 미도입.

## 알림 (로컬 알림, 서버 푸시 없음)

- 알림은 전부 **로컬 알림**(`UNUserNotificationCenter`)이다. APNs/서버 푸시 인프라는 없다.
- 설정 → "알림"(`NotificationSettingsView`)에서 축제/로컬 이벤트 알림을 **각각 별도 섹션**으로 커스터마이즈한다: 마스터 on/off, 카테고리 다중 선택, 지역(시·도)/반경(10/20/50km), 축제 한정 "저장한 축제 리마인더" 시점(당일/1·3·7일 전)·시각, 공통 방해 금지 시간·하루 최대 알림 수.
- 설정값은 App Group `UserDefaults` 키 `notificationPreferences` 에 저장한다(`NotificationPreferencesStore` / `NotificationPreferencesModel`).
- **새 항목 발견 알림**: `DiscoveryNotificationService` 가 `BGAppRefreshTask`(id `com.parkingnav.discovery.refresh`)로 깨어나 관심 조건에 맞는 좌표/반경으로 `/api/festivals`·`/api/local-events` 를 조회 → 카테고리 필터 → 이미 알린 ID 집합과 비교해 신규만 추출 → 방해 금지 시간/일일 한도를 적용해 **도메인별 요약 1건**의 로컬 알림을 보낸다. 알린 ID·일일 카운터·마지막 좌표(`lastKnownLocation.*`)도 App Group 에 저장한다.
- 조회 중심 좌표: 선택 지역이 있으면 시·도 centroid 평균, 없으면 `CurrentLocationProvider` 가 저장한 마지막 좌표, 그래도 없으면 서울시청.
- 백그라운드 실행 시점은 iOS 가 결정하므로 best-effort(지연/누락 가능). 발견 알림이 모두 꺼지면 `BGTaskScheduler` 예약을 취소한다.
- 저장한 축제 리마인더(`FestivalReminderService`)는 위 설정의 on/off·시점·시각을 따른다(이전엔 시작 전날 오전 9시 고정).
- iOS Info.plist 추가: `UIBackgroundModes=[fetch]`, `BGTaskSchedulerPermittedIdentifiers=[com.parkingnav.discovery.refresh]`. 위치는 when-in-use 만 사용(백그라운드 위치·Always 권한 불필요).

## 최근 유용한 커밋

최신 (2026-06-11):

- `dd87743 Make crayon theme fully hand-drawn: Gaegu handwriting font, rough controls and chips, wax double-stroke cards, crayon paper hatching`
- `f55a2a4 Style merchant pages with app honey theme and add legal consent popups`
- `d5e67c8 Remove max daily notification cap and update D1 migration workflow`
- `f47daa3 Fix build: add explicit RoughRoundedRectangle init`
- `5da1818 Add hand-drawn 크레파스(Crayon) theme to theme picker`

이전 (2026-06-02):

- `3e64067 Add customizable festival/local-event notification settings with background discovery`
- `c587edd Revamp calendar tab: inline agenda, category-colored dots, swipe nav, save & local-notification reminders`
- `cea4fca Optimize: 60s edge cache + single tags parse (Worker), hoist formatters/Calendar (iOS), remove dead discover-list code`

이전 (2026-05-26):

- `c65a3a5 Derive widget bundle id from app bundle id to fix embed validation`
- `f3465f2 Add festival calendar tab, Medium widget, and shared filter store`
- `b2ade17 Add legal pages route, iOS Privacy Manifest, and App Store privacy answers`
- `795f018 Bump iOS build number to 131`
- `7ebe783 Update app icon and display name`
- `9727bdf Lower Eventda icon wordmark`

이전 (2026-05-19):

- `116fbcb Widen local event sources, rebalance subrequest budget`
- `a0c9d5d Add Workers AI head agent and activity feed`
- `9d8be9d Stage Worker secrets with versions secret put in CI`
- `c31bf14 Add merchant signup link-out in Settings`
- `a5edbd8 Hide expired sponsored events from /api/local-events`
- `5b38483 Wire Toss Payments widget for merchant event publishing`
- `52a133e Add event start date and direct image upload to R2`
- `becadbf Use Kakao client secret when configured`
- `13908cd Add merchant signup landing with Naver/Kakao OAuth`

로컬 이벤트 발견 튜닝:

- `ae62f0d Lower local event auto-approve threshold to 0.75`
- `4bcc86a Approve local events without end_date when score clears threshold`
- `6cde706 Fill nationwide blind spots in local event regions`
- `d3a1d8a Dedupe local events by matched Kakao place id`
- `c54b414 Improve blog store-name extraction heuristics`
- `14fc382 Switch local event discovery to Naver Blog + Kakao Keyword`
- `dc4008f Skip blog matches whose event keyword is followed by negation`

이전 발견/주차 작업:

- `6c96a20 Include realtime parking in event recommendations`
- `3bdd7bd Unify event detail navigation`
- `c55f447 Defer event list cleanup on tab switch`
- `1eef0f4 Optimize event tab list loading`
- `a11ebdd Set Codemagic build fallback to 105`
- `6c3792f Fix Seoul provider pagination test`
- `69b3274 Enrich Seoul realtime parking coordinates`
- `5af815e Fix Seoul supplemental parking mapping`
