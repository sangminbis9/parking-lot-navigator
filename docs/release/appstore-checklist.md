# App Store 제출 체크리스트

마지막 재검토: 2026-09-12 (`master` @ `723077c`, iOS 빌드번호 298 — 296이 컴파일·TestFlight 검증 완료, 297·298은 미검증).
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
- [x] **지원 URL(Support URL) 확보** — `GET /legal/support` 페이지를 새로 만들었다(`worker-backend/src/legal/routes.ts`). App Store Connect 지원 URL 입력값:
  `https://parking-lot-navigator-api.parkingnav.workers.dev/legal/support`. 앱 소개·문의 이메일·FAQ(위치 권한 거부, 정보 오류 신고, 알림 토큰 삭제, 가게 이벤트 등록, 환불)·관련 문서 링크를 담았다. 설정 탭에도 **고객지원** 링크를 추가했다(`SettingsView.swift`). Worker deploy 완료, `GET /legal/support` HTTP 200 실측(2026-09-12).
- [x] **문의 이메일 실주소로 교체** — 기존 `privacy@eventda.app` / `merchant@eventda.app`은 **`eventda.app` 도메인 자체가 미등록(DNS NXDOMAIN, 2026-09-12 실측)**이라 메일이 반송되는 죽은 주소였다. 세 곳(`SettingsView.swift`의 문의하기 mailto, 개인정보처리방침 문의처, 환불·취소 문의)을 모두 `sangminbis9@gmail.com`으로 바꿨다(사용자 지정). 배포본에서 `/legal/privacy`·`/legal/refund-policy`의 `eventda.app` 잔존 0건, 새 주소 각 1건 확인.
- [x] **외부 데이터 출처와 실시간 정보 한계 고지** — Settings **데이터 안내** 카드에 한계 고지에 더해 **제공처 이름**을 넣었다(`SettingsView.swift` `dataSourceCard`, 빌드 298). 표기 문구는 D1 실측 `source` 값과 `backend/src/providers/createProviders.ts`의 활성 provider 목록에서 뽑은 실제 제공처만 담는다.
  - 행사·공연: 한국관광공사 TourAPI, 예술경영지원센터 공연예술통합전산망(KOPIS), 한국문화정보원 문화포털, 한국전시주최자협회(AKEI), 서울 열린데이터광장, 공공데이터포털(data.go.kr), 각 지방자치단체 누리집.
  - 주차장: 공공데이터포털 전국 주차장 정보, 서울 열린데이터광장 실시간 주차 정보, 한국교통안전공단, 한국공항공사, 인천국제공항공사, 카카오.
  - 가게 이벤트: 네이버 검색 오픈 API 공개 블로그 글 + 사장님 직접 등록.
- [x] **환불·취소 정책 앱 내 링크** — Settings **정보** 카드의 이용약관 아래에 `환불·취소 정책` 링크를 추가했다(`SettingsView.swift` `refundPolicyURL` + `linkRow`, 빌드 298). 대상은 이미 배포된 `GET /legal/refund-policy`이고 HTTP 200 실측(2026-09-12).
- [x] **앱 스크린샷 확보 — 규격 충족** — `docs/release/screenshots/iPhone-resized/` 7장이 **1242×2688(6.5" 디스플레이)**, `docs/release/screenshots/iPad-resized/` 7장이 **2064×2752(13" 디스플레이)**다 (2026-09-12, 사용자가 직접 편집·리사이즈). 6.9"를 올리지 않으면 6.5"가 아이폰 필수 슬롯이고, 이 앱은 `TARGETED_DEVICE_FAMILY`를 지정하지 않아 아이패드도 지원하므로 13"도 필수다 — 두 필수 슬롯이 모두 채워졌다. 최상위 941×1672 7장은 편집 원본이라 제출용이 아니다. 알파 채널 없음 확인. 자세한 내용은 `docs/release/screenshots/README.md`.

## 미완료 (제출 전 필요)

- [ ] **앱 소개 문구(이름·부제·설명·키워드) 작성** — 저장소 밖(App Store Connect) 입력값이라 확인할 수 없다. 사용자가 작성했다고 밝혔으나 내용을 받지 못해 애플 글자 수 한도(이름 30 / 부제 30 / 키워드 100 / 프로모션 170 / 설명 4000) 대조를 못 했다. **남은 마지막 제출 차단 항목이다.**

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
