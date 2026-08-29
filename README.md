# 이벤트다

목적지 주변 또는 관심 지역의 축제·공연·박람회·로컬 매장 이벤트를 지도와 캘린더로 발견하는 iOS 앱입니다.
발견한 행사에 실제로 방문할 때 주변 주차장 탐색과 길안내를 이어서 지원합니다.

사용자 흐름: 행사 발견 → 행사 상세 → 방문 결정 → 주변 주차장 확인 → 길안내

## 프로젝트 개요

- iOS 앱은 SwiftUI로 작성합니다(최소 지원 iOS 16, XcodeGen 기반).
- 운영 API는 Cloudflare Worker + Hono + D1(`worker-backend/`)입니다. 실제 배포되는 API는 이쪽입니다.
- `backend/`는 로컬 Fastify 백엔드와 provider/test 코드입니다.
- 행사 데이터는 TourAPI, KOPIS, 문화포털, 지자체 공개 데이터, AKEI 전시 게시판에서 수집해 `discovery_items`로 모읍니다.
- 로컬 매장 이벤트는 Naver Search Open API(블로그)와 Kakao Local Keyword Search만으로 수집합니다.
- 주차 데이터는 서울 열린데이터광장, data.go.kr/한국교통안전공단 provider를 adapter로 통합합니다.
- 목적지 검색과 좌표 변환은 Kakao Local API를 서버에서 호출합니다. iOS 앱에는 REST 키를 넣지 않습니다.

## 폴더 구조

```text
ios-app/        SwiftUI 앱, Share Extension, Widget, App Intents
worker-backend/ Cloudflare Worker 운영 API, D1 마이그레이션, 수집 파이프라인
backend/        Fastify API, provider aggregation, ranking, cache, tests
shared-types/   iOS/백엔드/Worker가 공유하는 DTO 타입
docs/           아키텍처, 운영, 개인정보, 배포 문서
```

## 앱이 쓰는 주요 API

```text
GET  /api/festivals            축제·공연·박람회 목록
GET  /api/festivals/:id        행사 상세
GET  /api/performances         공연(KOPIS + 음악/공연 축제)
GET  /api/local-events         로컬 매장 이벤트
GET  /api/map/items            지도 핀
POST /api/event-reports        행사 정보 오류 신고
POST /api/local-events/report  새 로컬 이벤트 제보
POST /api/notifications/register  알림 기기 등록
POST /api/analytics            익명 사용 집계
```

## 로컬 실행 방법

```bash
pnpm install
cp .env.example backend/.env
pnpm --filter @parking/backend dev
```

백엔드는 기본적으로 mock provider로 실행되며 API 키 없이 동작합니다.

```bash
curl "http://localhost:4000/search/destination?q=서울역"
curl "http://localhost:4000/parking/nearby?lat=37.5547&lng=126.9706&radiusMeters=800"
```

## 테스트

```bash
pnpm -C worker-backend typecheck
pnpm -C worker-backend test
pnpm --filter @parking/backend test
pnpm --filter @parking/backend preflight
```

## iOS 설정 방법

1. `ios-app/Config/Debug.xcconfig.example`을 복사해 `Debug.xcconfig`를 만듭니다.
2. `ios-app/Config/Release.xcconfig.example`을 복사해 `Release.xcconfig`를 만듭니다.
3. `API_BASE_URL`, `APP_GROUP_ID`, `KAKAO_NATIVE_APP_KEY`를 채웁니다.
4. `brew install xcodegen`
5. `cd ios-app && xcodegen generate`
6. Xcode에서 `ParkingLotNavigator.xcodeproj`를 열고 실행합니다.

프로젝트 파일과 번들 식별자는 초기 이름(`ParkingLotNavigator`)을 그대로 씁니다. 사용자에게 보이는 이름만 `이벤트다`입니다.

Mac이 없다면 Codemagic으로 빌드합니다. 자세한 절차는 `docs/release/codemagic-guide.md`를 확인하세요.

## Worker 배포

```bash
pnpm -C worker-backend run deploy
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/<migration>.sql
```

Worker 코드만 바꾼 경우 iOS 빌드는 필요 없습니다. D1 스키마를 바꾸면 항상 새 마이그레이션을 추가합니다.

## 실제 API 연결 방법

- 백엔드 `.env`에 `KAKAO_REST_API_KEY`, `SEOUL_OPEN_DATA_KEY`, `PUBLIC_DATA_SERVICE_KEY`, `KOPIS_API_KEY`, `KCISA_428_API_KEY`, `KCISA_196_API_KEY`를 넣습니다. 문화포털 키가 공공데이터포털 키와 다르면 `CULTURE_PORTAL_API_KEY`도 넣습니다.
- Worker 쪽 키(`NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `KAKAO_REST_API_KEY`, `APNS_*`)는 wrangler secret으로 넣습니다.
- `PARKING_PROVIDER_MODE=hybrid`는 mock과 실제 provider를 함께, `real`은 실제 provider만 사용합니다.

## 출시 전 점검 순서

1. Worker typecheck/test, 백엔드 테스트와 preflight 통과
2. 필요한 D1 마이그레이션이 remote에 적용되었는지 확인
3. iOS Debug/Release 빌드 확인
4. 실제 기기에서 행사 발견 → 상세 → 즐겨찾기 → 주차 → 길안내 흐름 확인
5. 푸시 딥링크, Share Extension, Widget, App Group 전달 확인
6. 위치 권한 문구, 개인정보 처리방침/이용약관 링크, `PrivacyInfo.xcprivacy` 확인

## 알려진 한계

- 실시간 주차 데이터는 제공 범위와 갱신 지연이 있으며, 앱은 freshness와 stale 배지로 표시합니다.
- AKEI 무역박람회는 원본 게시 범위가 현재~3개월이라 그보다 먼 미래는 비어 보입니다.
- 일부 수집 소스는 원본에 요금 필드가 없어 요금이 `unknown`으로 남습니다.
- Kakao Mobility iOS UI SDK는 별도 계약과 SDK 설치가 필요합니다.
