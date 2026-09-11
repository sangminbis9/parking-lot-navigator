# App Store 제출 체크리스트

마지막 재검토: 2026-09-11 (`master` @ `67ac768`, iOS 빌드번호 296 — 컴파일·TestFlight 검증 완료).
판정은 전부 실제 코드·설정·production 응답에서 확인한 것이고, 저장소 밖 사실(스토어 입력, 계약, 실기기 동작)은 "사용자 확인 필요"로 남겼다.
항목별 근거와 우선순위는 `docs/release/deployment-readiness-report.md` 참고.

## 완료 (코드/설정으로 확인됨)

- [x] **App Group entitlement 확정** — `Resources/ParkingLotNavigatorApp.entitlements`(앱, app-groups + aps-environment), `Resources/ParkingLotNavigator.entitlements`(확장, app-groups만). 값은 `$(APP_GROUP_ID)`로 xcconfig에서 주입된다.
- [x] **Associated Domains 필요 여부 확정 — 불필요** — entitlements 어디에도 `com.apple.developer.associated-domains`가 없고, 딥링크는 URL scheme `parkingnavigator://`(`Resources/AppInfo.plist:52-55`)만 쓴다. Universal Links는 출시 후 과제로 남긴다.
- [x] **위치 권한 사용 목적 문구 작성** — `NSLocationWhenInUseUsageDescription`(`Resources/AppInfo.plist:58`): "현재 위치 주변의 이벤트·축제와 가까운 주차장을 보여주고, 선택한 장소까지 길안내를 제공하기 위해 위치 정보를 사용합니다." Always 권한은 요청하지 않는다.
- [x] **첫 실행 위치 권한 UX** — 앱 실행 즉시 시스템 팝업이 뜨지 않는다. 권한이 이미 있으면 조용히 시작하고(`startIfAuthorized()`), 사용자가 "내 주변 행사 보기"를 눌렀을 때만 `request()`가 팝업을 띄운다. 거부해도 앱은 막히지 않고 마지막 위치 → 저장된 지역 → 서울 순으로 동작한다(`Core/Services/FallbackLocation.swift`).
- [x] **백그라운드 모드 확인** — `UIBackgroundModes = [fetch]`(`AppInfo.plist:35-38`), `BGTaskSchedulerPermittedIdentifiers = [com.parkingnav.discovery.refresh]`(같은 파일 39-41). `remote-notification`은 **없다** — 서버 푸시가 alert 방식이라 필요하지 않다. 심사에서 백그라운드 사용 사유(로컬 행사 발견 갱신)를 설명할 수 있어야 한다.
- [x] **알림 권한 동작 확인** — 발견 알림을 처음 켤 때만 권한을 요청한다. **다가오는 행사 알림(D-30/D-7/D-1)은 Worker cron이 APNs로 직접 보내는 서버 푸시다** — 이전 판의 "로컬 알림 전용·APNs 미사용" 서술은 사실이 아니었다. `aps-environment` entitlement가 Debug=`development` / Release=`production`으로 갈린다(`project.yml:56-60`). 저장한 축제 리마인더와 로컬 발견 알림만 기기 로컬 알림으로 남아 있다.
- [x] **개인정보 처리방침 게시** — `GET /legal/privacy` HTTP 200 (2026-09-11 실측). `/legal/terms`, `/legal/refund-policy`도 200.
- [x] **Privacy Manifest** — `Resources/PrivacyInfo.xcprivacy` 존재. `99f2fc2`로 검색 기록 서버 수집이 제거돼 App Privacy 답변과 코드가 일치한다. 외부 크래시 SDK가 없으므로 "크래시 데이터 미수집" 선언도 정합.
- [x] **암호화 수출 규정** — `ITSAppUsesNonExemptEncryption`(`AppInfo.plist:26`) 선언됨.
- [x] **Bundle ID 확정** — `PRODUCT_BUNDLE_IDENTIFIER = $(APP_BUNDLE_ID)`, 실제 값은 gitignore된 `Config/{Debug,Release}.xcconfig`에 있어 저장소로는 못 본다. **TestFlight 업로드가 성공했다는 것은 Release xcconfig의 Bundle ID가 ASC에 등록된 App ID와 일치하고 프로비저닝도 맞는다는 뜻**이므로 이 항목은 닫힌다.
- [x] **iOS 빌드 / TestFlight** — build 296 컴파일 성공, TestFlight 업로드·실행 확인 (2026-09-11, 사용자). 이전 회차에서는 WSL2 환경에 Xcode가 없어 Swift 변경 11개 파일이 미검증 상태였다.
- [x] **App Store Connect App Privacy 입력** — 질문지 + Privacy Policy URL 입력 완료 (2026-09-11, 사용자 확인). 답변 근거는 readiness report 1장에 248줄로 남아 있다.

## 미완료 (제출 전 필요)

- [ ] **앱 스크린샷과 설명 준비** — 산출물이 아직 없다. **지금 제출을 막는 유일한 항목.** 필수 규격은 **6.9" 1장 이상**(1320×2868 / 1290×2796 / 1260×2736, sRGB PNG·JPEG, 투명도 불가)이고 6.5"는 6.9"를 내지 않을 때만 필요하다 — 이전 판의 `6.7"/6.5" 각 5장` 서술은 현재 Apple 요구사항과 다르다(2026-09-11 확인). 첫 2장에 지도와 행사 상세를 둔다. 캡처는 `.github/workflows/ios-screenshots.yml`을 수동 실행해 macOS 러너에서 뽑는다(로컬 Mac 불필요).
- [ ] **외부 데이터 출처와 실시간 정보 한계 고지** — **앱 안 어디에도 출처 표기가 없다**(`rg -n "data.go.kr|KOPIS|한국관광공사" ios-app -g '*.swift'` → 0건). 이전 판의 "Settings에 표기 존재" 서술은 사실과 달랐다. 최소한 Settings에 한 줄이 필요하다.
- [ ] **환불·취소 정책 앱 내 링크** — 페이지는 배포됐지만 Settings는 개인정보 처리방침·이용약관만 링크한다(`SettingsView.swift:193-194`). 결제를 켜는 시점에는 필수.

## 사용자 확인 필요 (저장소로 판정 불가)

- [ ] **Kakao Mobility SDK 상용 사용 권한 확인** — `KakaoSDKNavi`(kakao-ios-sdk 2.27.2)를 길안내에 쓴다. SDK 연동 여부가 아니라 상용 서비스 이용 조건·표기 의무가 충족되는지가 남은 질문이다.
- [ ] **심사용 데모 모드 또는 테스트 계정 준비** — 로그인이 없는 앱이라 계정은 불필요해 보이지만, 위치 권한 없이도 전국 행사를 볼 수 있다는 점을 심사 메모에 적어 두는 편이 안전하다.
- [ ] **실기기 세부 확인** — VoiceOver, 다크모드, 위치 권한 거부 흐름, 서버 푸시 수신(production APNs). TestFlight 실행 확인은 앱이 뜨는 데까지이고 이 넷은 별개다. 특히 서버 푸시는 TestFlight 빌드가 Release 설정이라 `aps-environment = production`으로 도는데, 이 경로는 아직 실측 기록이 없다.
- [ ] **공유 확장 설명 작성** — `ParkingShareExtension`이 스토어 설명에 언급될 필요가 있는지 판단.

## 이번 출시에서 의도적으로 하지 않는 것

- 외부 크래시 트래킹 SDK 도입 (사용자 결정, 2026-09-11). 관측은 `AppLogger` + Workers Logs로만.
- 즐겨찾기·설정·알림함의 클라우드 동기화. 현재 전부 device-local이고 그대로 둔다.
- 레거시 명칭(`ParkingLotNavigator`, bundle identifier 계열, URL scheme, App Group, BGTask identifier) rename. 출시 직전 signing·딥링크·백그라운드 태스크 회귀 위험 때문에 기술 부채로만 기록한다.
- 오프라인 캐시 시스템. 네트워크 실패는 구분된 메시지 + 재시도로만 처리한다.
