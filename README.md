# 서울 주차 내비게이터

서울 목적지 주변 주차 추천, 실시간 주차 정보, 인앱 내비게이션을 하나의 흐름으로 제공하는 iOS 실서비스 후보 프로젝트입니다.

## 프로젝트 개요

- iOS 앱은 SwiftUI로 작성합니다.
- 백엔드는 Fastify + TypeScript로 작성합니다.
- 목적지 검색과 좌표 변환은 Kakao Local API를 백엔드에서 호출합니다.
- 주차 데이터는 mock, 서울 열린데이터광장, data.go.kr/한국교통안전공단 provider를 adapter로 통합합니다.
- 내비게이션 SDK는 `NavigationService` 뒤에 숨기고, Objective-C bridge로 Kakao Mobility iOS UI SDK를 연결할 수 있게 둡니다.

## 폴더 구조

```text
ios-app/        SwiftUI 앱, App Intents, Share Extension, NavigationBridge
backend/        Fastify API, provider aggregation, ranking, cache, tests
shared-types/   백엔드와 클라이언트가 공유할 DTO 타입
docs/           아키텍처, 운영, 개인정보, 배포 문서
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
curl "http://localhost:4000/parking/providers/health"
```

## 테스트

```bash
pnpm --filter @parking/backend test
pnpm --filter @parking/backend preflight
pnpm --filter @parking/backend release:check
```

## iOS 설정 방법

1. `ios-app/Config/Debug.xcconfig.example`을 복사해 `Debug.xcconfig`를 만듭니다.
2. `ios-app/Config/Release.xcconfig.example`을 복사해 `Release.xcconfig`를 만듭니다.
3. `API_BASE_URL`, `APP_GROUP_ID`, `KAKAO_NATIVE_APP_KEY`를 채웁니다.
4. `brew install xcodegen`
5. `cd ios-app && xcodegen generate`
6. Xcode에서 `ParkingLotNavigator.xcodeproj`를 열고 실행합니다.

Mac이 없다면 Codemagic으로 빌드합니다. 자세한 절차는 `docs/release/codemagic-guide.md`를 확인하세요.

## 실제 API 연결 방법

- 백엔드 `.env`에 `KAKAO_REST_API_KEY`, `SEOUL_OPEN_DATA_KEY`, `PUBLIC_DATA_SERVICE_KEY`를 넣습니다.
- `PARKING_PROVIDER_MODE=hybrid`로 설정하면 mock과 실제 provider를 함께 사용합니다.
- `PARKING_PROVIDER_MODE=real`은 실제 provider만 사용합니다. 키 또는 계정 승인이 없으면 provider health가 `down`으로 표시됩니다.
- iOS 앱에는 민감한 REST 키를 넣지 않습니다.

## TestFlight 전 점검 순서

1. 백엔드 테스트와 preflight 통과
2. 실제 provider health 확인
3. iOS Debug/Release 빌드 확인
4. 실제 기기에서 검색, 주차 결과, 상세, mock 또는 Kakao 내비 진입 확인
5. App Intent, Share Extension, deep link, App Group 전달 확인
6. 위치 권한 문구와 개인정보 문서 확인

## 알려진 한계

- 서울 실시간 주차 데이터는 제공 범위와 갱신 지연이 있으며, 앱은 이를 freshness와 stale 배지로 표시합니다.
- Kakao Mobility iOS UI SDK는 별도 계약과 SDK 설치가 필요합니다.
- 현재 iOS 프로젝트는 XcodeGen 기반 스캐폴드이며, 실제 signing은 개발자 계정에서 수동 설정해야 합니다.

## 다음 단계

- 실제 API 키 주입 후 hybrid provider health 검증
- Kakao Mobility SDK 프레임워크 추가 및 bridge 연결
- TestFlight용 bundle id, App Group, Associated Domains 확정
- 운영 로그 수집 및 provider dashboard 시각화 보강
