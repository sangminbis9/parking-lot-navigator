# Codemagic 빌드와 TestFlight 업로드 가이드

Mac 없이 iPhone 16에서 앱을 설치하려면 Codemagic으로 macOS 빌드를 만들고 TestFlight로 배포합니다.

## 1. Codemagic 앱 연결

1. Codemagic에 GitHub 계정으로 로그인합니다.
2. `sangminbis9/parking-lot-navigator` 저장소를 앱으로 추가합니다.
3. 빌드 설정 방식은 `codemagic.yaml`을 선택합니다.

## 2. 먼저 실행할 workflow

처음에는 `ios-simulator-build`를 실행합니다.

이 workflow는 signing 없이 XcodeGen 프로젝트 생성과 시뮬레이터 빌드만 확인합니다. 여기서 통과해야 TestFlight signing 문제를 분리해서 볼 수 있습니다.

## 3. Codemagic 환경 변수 그룹

Codemagic 앱 설정의 Environment variables에서 아래 그룹을 만듭니다.

### ios_runtime_config

- `API_BASE_URL`: 배포된 백엔드 주소
- `KAKAO_NATIVE_APP_KEY`: Kakao Native App Key

실제 기기에서 TestFlight 앱을 쓰려면 `API_BASE_URL`은 `localhost`가 아니라 외부에서 접근 가능한 HTTPS 주소여야 합니다.

### appstore_credentials

App Store Connect API Key를 Codemagic integration으로 쓰는 경우에는 Codemagic UI의 Developer Portal integration에 등록합니다. 직접 환경 변수 방식으로 쓰는 경우에는 다음 값을 secret으로 저장합니다.

- `APP_STORE_CONNECT_PRIVATE_KEY`
- `APP_STORE_CONNECT_KEY_IDENTIFIER`
- `APP_STORE_CONNECT_ISSUER_ID`

## 4. Apple Developer에서 필요한 식별자

Apple Developer 승인이 완료되면 아래 App ID를 만듭니다.

- 앱: `com.sangminbis9.ParkingLotNavigator`
- Share Extension: `com.sangminbis9.ParkingLotNavigator.ShareExtension`
- App Group: `group.com.sangminbis9.ParkingLotNavigator`

App Intents는 첫 빌드 안정성을 위해 메인 앱 target에 포함합니다. Share Extension target은 같은 App Group entitlement를 사용할 수 있게 설정합니다.

## 5. TestFlight workflow

Apple signing 설정이 준비되면 `ios-testflight` workflow를 실행합니다.

이 workflow는 다음 작업을 수행합니다.

- 백엔드 테스트
- XcodeGen 설치
- Codemagic 환경 변수로 iOS xcconfig 생성
- Xcode 프로젝트 생성
- Codemagic signing profile 적용
- IPA 빌드
- App Store Connect 업로드

첫 버전은 App Store Connect 앱 레코드를 먼저 만들어야 합니다. TestFlight 외부 테스터 제출은 Apple 베타 심사가 필요하므로, 처음에는 내부 테스트로 확인합니다.

## 6. 자주 막히는 지점

- `No profiles found`: Bundle ID 또는 extension Bundle ID용 provisioning profile이 없습니다.
- `App Group entitlement mismatch`: Apple Developer의 App ID capability와 `APP_GROUP_ID`가 다릅니다.
- `App Store Connect app not found`: App Store Connect에 앱 레코드가 아직 없습니다.
- 앱에서 API 호출 실패: `API_BASE_URL`이 외부 HTTPS 주소가 아니거나 백엔드가 배포되지 않았습니다.

## 7. 참고 문서

- Codemagic iOS signing: https://docs.codemagic.io/yaml-code-signing/signing-ios/
- Codemagic App Store Connect 배포: https://docs.codemagic.io/yaml-publishing/app-store-connect/
