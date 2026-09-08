# 이벤트다 포트폴리오 소개 영상 — 대본과 타임라인

- 최종 파일: `out/eventda-portfolio.mp4` (1920×1080 · 30fps · 86.5초 · H.264/yuv420p · 약 3.5MB)
- 편집 원본: `src/index.html` (전체 타임라인이 이 한 파일에 들어 있다)
- 렌더 스크립트: `render.mjs` (`node render.mjs`)
- 내레이션 없음. 화면 + 짧은 한국어 자막만. BGM 없음.

전체 길이는 `src/index.html` 아래쪽의 `window.DURATION = 86.5`가 정한다.
각 장면은 `<section class="scene" data-in="시작초" data-out="끝초">`이고,
장면 안의 요소는 `data-at`(장면 시작 기준 상대 초) / `data-dy`(아래에서 위로 올라오는 거리)로 등장한다.

---

## 타임라인 요약

| 구간 | 초 | 장면 | 화면 |
|---|---|---|---|
| S1 | 0 – 8 | 문제 제기 + 서비스 소개 | 질문 두 줄 → 앱 아이콘 + 이름 + 한 문장 소개 |
| S2 | 8 – 13.4 | 01/04 지도 | 지도 탭 구성도 + 기능 설명 3줄 + 실제 파일 경로 |
| S3 | 13.4 – 18.6 | 02/04 행사 상세 | 상세 화면 구성도 (기간·장소·요금·프로그램·신고) |
| S4 | 18.6 – 23.8 | 03/04 캘린더 | 월 달력 + 날짜별 목록 구성도 |
| S5 | 23.8 – 29.2 | 04/04 주변 주차 | 주차장 목록 + 실시간 잔여 면수 + 길안내 버튼 |
| S6 | 29.2 – 33.6 | iOS 플랫폼 기능 | 위젯 · 공유 시트 · Siri 단축어 · 푸시/딥링크 4장 카드 |
| S7 | 33.6 – 54.6 | 데이터 파이프라인 | 소스 10종 → Worker 처리 4단계 → D1 / API / 앱 |
| S8 | 54.6 – 70.0 | 엔지니어링 · 제약 | 스택 12개 + 제약 3장 + 실제 마이그레이션 SQL 확대 |
| S9 | 70.0 – 79.0 | 개인 개발 범위 | 6단계 + 저장소 집계 숫자 4개 + 수집 정책 |
| S10 | 79.0 – 86.5 | 엔딩 | 아이콘 · 이벤트다 · 스택 · GitHub URL |

제안받은 구성(0–7 / 7–25 / 25–45 / 45–60 / 60–75 / 마지막 5–10초)에서 바꾼 곳은 두 군데다.
데이터 파이프라인 구간을 21초로 늘렸고(소스 10종과 처리 4단계를 읽을 시간이 필요했다),
그만큼 전체를 86.5초로 잡았다. 요구 범위인 60–90초 안이다.

---

## 장면별 자막 전문과 근거

### S1 (0–8초) — 문제 제기와 서비스 소개

```
주변에서 열리는 행사를,
지나치기 전에 발견할 수 없을까?

[앱 아이콘]  이벤트다
여러 곳에 흩어진 지역 행사 데이터를 수집·정제해 지도와 캘린더에서 탐색하고,
행사 발견부터 방문과 주차까지 이어주는 iOS 서비스

개인 프로젝트 · SwiftUI · Cloudflare Workers · D1
```

근거: 앱 표시 이름 `이벤트다`는 `ios-app/Resources/AppInfo.plist`의 `CFBundleDisplayName`.
아이콘은 `ios-app/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` 원본.

### S2 (8–13.4초) — 01/04 지도에서 주변 행사 찾기

```
지도에서 주변 행사 찾기
· 목적지 주변의 축제 · 공연 · 박람회 · 로컬 매장 이벤트를 한 지도에
· 카테고리별 핀과 공연 레이어 토글, 중복 핀 제거
· 현재 위치와 검색 목적지 기준을 함께 지원

ios-app/Features/Map/MapHomeView.swift
ios-app/Features/Map/MapPinRenderer.swift
ios-app/Features/Map/MapSearchOverlay.swift
```

화면 오른쪽 위에 `SwiftUI 뷰 구조를 옮긴 구성도 · 실행 화면 캡처 아님` 배지가 S2–S5 내내 붙어 있다.

### S3 (13.4–18.6초) — 02/04 행사 상세

```
기간 · 장소 · 요금과 프로그램을 한 화면에
· 소스마다 다른 요금 표기를 무료 / 유료 / 확인 불가로 정규화해 표시
· 프로그램과 출연진은 원본에 있는 문장만 보여준다
· 잘못된 정보는 앱에서 바로 신고 — 신고자 식별 정보는 저장하지 않음

ios-app/Features/ParkingResults/ParkingResultsView.swift
ios-app/Features/ParkingResults/EventReportSheet.swift
worker-backend/src/feeNormalize.ts
```

구성도 안의 예시 행사(`한강 가을 야시장 & 거리공연 페스티벌`)는 화면 레이아웃을 보여주기 위한
가상의 예시이며, 실제 수집된 데이터가 아니다.

### S4 (18.6–23.8초) — 03/04 캘린더

```
날짜로 찾는 캘린더
· 월 달력과 날짜별 행사 목록, 그 아래 근처 공연 섹션
· 조회 기간 · 거리 반경 · 지역 · 카테고리 필터를 지도 탭과 공유
· D-30 / D-7 / D-1 다가오는 행사 푸시 알림

ios-app/Features/Calendar/CalendarTabView.swift
ios-app/Features/Calendar/FilterSheetView.swift
worker-backend/src/upcomingNotifications.ts
```

달력 격자는 2026년 9월 기준으로 그린다(9월 1일이 화요일이라 앞 칸 둘을 비운다).

### S5 (23.8–29.2초) — 04/04 행사에서 주변 주차까지

```
행사에서 주변 주차까지
· 행사 좌표를 기준으로 주변 주차장을 거리순으로
· 서울시 실시간 주차 정보가 있는 곳은 잔여 면수까지 함께
· 고른 주차장으로 길안내 앱을 바로 연결

ios-app/Features/ParkingResults/NearbyParkingMapView.swift
ios-app/Integrations/NavigationBridge/KakaoNavigationService.swift
backend/src/providers/SeoulRealtimeParkingProvider.ts
```

목록의 주차장 이름과 잔여 면수는 화면 구성을 보여주는 예시 값이다.

### S6 (29.2–33.6초) — iOS 플랫폼 기능

```
앱 밖에서도 이어지도록 — 별도 타깃과 시스템 연동을 직접 구성했다.

홈 화면 위젯       다가오는 행사를 Small · Medium · Large 세 크기로.
                  Integrations/WidgetKit/UpcomingFestivalsWidget.swift
공유 시트          다른 앱에서 장소·링크를 공유해 목적지로 보낸다.
                  Integrations/ShareExtension/ShareViewController.swift
Siri 단축어        App Intents로 목적지 주변 주차 찾기와 최근 목적지 길안내.
                  Integrations/AppIntents/ParkingAppShortcuts.swift
푸시 알림 · 딥링크   서버가 보낸 알림을 눌러 해당 행사 상세로 바로 이동.
                  Integrations/DeepLinks/
                  Core/Services/NotificationRegistrationService.swift
```

### S7 (33.6–54.6초) — 데이터 파이프라인

```
서로 다른 공개 데이터를 하나의 스키마로
필드도 좌표 정확도도 제각각인 소스를 모아, 같은 행사를 하나로 묶고 부족한 값을 나중에 채워 넣는다.

[공개 데이터 소스]
TourAPI 축제 검색 · TourAPI 지역 기반 · TourAPI 키워드 · 공공데이터 문화축제 ·
서울 열린데이터 문화행사 · 문화포털 · KOPIS 공연예술전산망 · 지자체 축제 페이지 · AKEI 전시 게시판
로컬 매장 이벤트: Naver 검색 API + Kakao Local

[Cloudflare Worker 처리]
01 정규화      소스마다 다른 제목 · 기간 · 좌표 · 요금 표기를 하나의 행 모양으로 맞춘다.
              feeNormalize.ts · cityFestivalNormalize.ts
02 중복 병합    연도 · 회차 · 주최 기관 접두어를 벗겨 같은 행사를 하나로 묶는다.
              discoveryCache.ts — dedupeFestivals()
03 LLM 카테고리 태깅
              Workers AI Llama 3.3 70B로 12개 축제 카테고리를 분류하고,
              실패하면 규칙 기반으로 되돌린 뒤 7일 후 다시 시도한다.
              llmTagging.ts · llmTaggingFallback.ts
04 보강 배치    목록 API에 없는 요금 · 이미지 · 좌표 · 프로그램을 회차마다 나눠 채운다.
              크롤한 프로그램은 원문에 문자 그대로 있는 줄만 통과시킨다.
              feeBackfill.ts · programCrawl.ts — isGrounded()

[저장과 제공]
D1 (SQLite)     discovery_items · local_events · realtime_parking_status · migrations/0001 – 0031
Hono REST API   앱은 원본 API를 직접 부르지 않는다.
                /api/festivals · /api/performances · /api/local-events · /api/map/items
SwiftUI 앱      지도 · 캘린더 · 위젯 · 푸시 알림 — APNs · WidgetKit · App Intents
```

### S8 (54.6–70.0초) — 한도 안에서 계속 돌게 만드는 일

```
[스택] SwiftUI · WidgetKit · App Intents · Cloudflare Workers · Hono · D1 ·
       Cloudflare Queues · Workers AI · APNs · TypeScript · Vitest · Zod

제약: invocation당 외부 요청 50건
  한 번에 다 부르면 51번째부터 통째로 실패한다.
  cron 슬롯을 나눠 회차마다 한 작업만 돌리고, 배치 상한을 45건으로 묶었다.
  worker-backend/src/jobs.ts · feeBackfill.ts — FEE_BACKFILL_MAX_ITEMS

제약: D1 하루 읽기 500만 · 쓰기 10만 행
  초과해도 예외가 나지 않아 조용히 새어 나간다.
  대상 행만 담는 부분 인덱스로 스캔을 줄이고, 값이 실제로 바뀐 행만 쓰는 조건부 upsert로 바꿨다.
  migrations/0027 · 0028 · 0031 · tests/discoveryConditionalWrite.test.ts

제약: invocation 리소스 한도
  HTML 파싱 회차가 통째로 죽으면서 결과가 한 건도 안 남았다.
  회차 크기를 4건으로 낮추고 2건마다 즉시 저장해, 죽어도 앞선 작업이 살아남게 했다.
  programCrawl.ts — PROGRAM_CRAWL_MAX_ITEMS · docs/operations/worker-limits.md

[코드 확대] worker-backend/migrations/0031_d1_backfill_scan_indexes.sql
  -- 태깅이 필요한 행만 인덱스에 담아, 대상 선정이 테이블 전체를 훑지 않게 한다
  CREATE INDEX idx_discovery_tagging_pending
    ON discovery_items (tagging_version, tagged_at)
    WHERE tagging_version <= 0;

읽기를 줄이는 인덱스는 쓰기를 늘린다. 그래서 인덱스를 더하는 만큼 쓰지 않는 인덱스를 지웠다.
```

### S9 (70.0–79.0초) — 개인 개발 범위

```
기획부터 배포까지 혼자 맡았다
01 기획 · 02 데이터 수집 · 03 백엔드 · 04 iOS 앱 · 05 알림 · 06 테스트 · 배포

98개   iOS Swift 파일 (약 23,000줄)
76개   Worker TypeScript 파일 (약 19,600줄)
31개   D1 마이그레이션 (0001 – 0031)
382개  자동화 테스트 (59개 파일 전부 통과)

저장소 기준 집계 · 2026-09-08 · 실제 사용자 대상 운영 지표가 아니다.

데이터 수집 정책도 직접 정했다 — 공개 API와 공개 페이지만 쓰고,
봇 탐지 우회나 로그인 흉내는 하지 않으며, 개인정보는 저장하지 않는다.
```

### S10 (79.0–86.5초) — 엔딩

```
[앱 아이콘]
이벤트다
SwiftUI · Cloudflare Workers · D1
github.com/sangminbis9/parking-lot-navigator
```

---

## 편집 방법

문구만 고치려면 `src/index.html`에서 해당 장면 섹션의 텍스트를 바꾸고 `node render.mjs`를 다시 돌린다.
장면 길이를 바꾸려면 `data-in` / `data-out`을 고치고, 마지막 장면의 `data-out`에 맞춰
파일 아래쪽 `window.DURATION` 값을 같이 고쳐야 한다. 자세한 절차는 `README.md`.
