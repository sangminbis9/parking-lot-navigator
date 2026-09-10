# App Store Connect — App Privacy 입력 가이드

대상: 이벤트다 (`ParkingLotNavigator`) iOS 1.0 (build 295)
작성일: 2026-09-10
기준 커밋: `master` HEAD (`513fb14` 이후 — Search History 서버 전송 제거 반영)

근거 파일 (이 문서의 모든 항목은 아래 코드에서 실제로 확인한 것만 적었다):

| 확인 대상 | 파일 |
| --- | --- |
| 개인정보 매니페스트 | `ios-app/Resources/PrivacyInfo.xcprivacy` |
| APNs 등록·토큰 처리 | `ios-app/App/AppDelegate.swift`, `ios-app/Core/Services/NotificationRegistrationService.swift` |
| Push entitlement | `ios-app/project.yml` (`APS_ENVIRONMENT`), `ios-app/Resources/ParkingLotNavigatorApp.entitlements` |
| 익명 기기 식별자 | `ios-app/Core/Storage/LocalStores.swift` (`AnonymousDeviceStore`) |
| 익명 사용 집계 | `ios-app/Core/Services/AnalyticsService.swift` |
| 오류 신고 본문 | `ios-app/Core/Models/EventReport.swift`, `ios-app/Features/ParkingResults/EventReportSheet.swift` |
| 공유 확장 | `ios-app/Integrations/ShareExtension/ShareViewController.swift`, `ios-app/Core/Storage/LocalStores.swift` (`SharedDestinationStore`) |
| 백그라운드 모드·위치 권한 | `ios-app/Resources/AppInfo.plist` |
| 서버 수신·보관 | `worker-backend/src/index.ts`, `worker-backend/src/notificationRegistration.ts`, `worker-backend/src/analytics.ts` |
| 공개 개인정보처리방침 | `worker-backend/src/legal/routes.ts` (`/legal/privacy`) |

실제 입력은 App Store Connect 웹 UI에서 진행한다. 이 문서는 그 화면에서 고를 항목을 그대로 옮겨 적을 수 있게 정리한 것이다.

---

## 0. 이번 갱신에서 바로잡은 잘못된 설명

이전 버전 문서(2026-05-25, build 132 기준)에 실제 구현과 다른 서술이 있어 아래와 같이 고쳤다.

| 이전 서술 | 현재 코드 | 처리 |
| --- | --- | --- |
| "알림은 전부 로컬 알림이며 APNs/서버 푸시를 사용하지 않는다" | `AppDelegate.application(_:didFinishLaunchingWithOptions:)`가 알림 권한이 있으면 `registerForRemoteNotifications()`를 호출한다. Debug/Release 모두 `APS_ENVIRONMENT` entitlement가 있다. | 삭제하고 §3-2로 대체 |
| "디바이스 푸시 토큰을 수집/전송하지 않는다" | `didRegisterForRemoteNotificationsWithDeviceToken`이 토큰을 hex로 만들어 App Group `UserDefaults`에 저장하고, `NotificationRegistrationService`가 `POST /api/notifications/register`로 서버에 보낸다. | 삭제하고 §3-2로 대체 |
| Analytics 관련 항목 없음 / "Other Usage Data: No" | `AnalyticsService`가 정해진 13개 이벤트의 **횟수**를 모아 `POST /api/analytics`로 보낸다. | §3-3 신설 (Usage Data → Product Interaction = Yes) |
| "Search History: No" | 2026-09-10 갱신 시점에는 `recordSearchHistory`가 검색어·목적지명·주소·목적지 좌표를 익명 기기 식별자와 함께 `POST /analytics/search-history`로 보내고 있었다. 그 뒤 전송·수신·보관 코드를 앱·Worker·backend에서 모두 제거했다. | **다시 No.** 매니페스트의 `NSPrivacyCollectedDataTypeSearchHistory` 항목도 삭제 (§4 참고) |
| "Diagnostics → Crash Data / Performance Data: Yes (Sentry/Crashlytics 도입 시)" | 저장소 어디에도 Sentry·Crashlytics·Firebase 등 진단 SDK가 없다. SPM 의존성은 `KakaoMapsSDK`, `KakaoOpenSDK` 둘뿐이다. | **No**로 변경 (§4) |
| "User Content → Other User Content (공유 확장)" | 공유 확장은 받은 텍스트를 App Group `UserDefaults`에만 저장하고 앱이 소비하면 지운다. 외부 전송이 없다. 실제로 서버에 올라가는 사용자 작성 내용은 **행사 오류 신고의 선택 메모**다. | 사유를 오류 신고로 정정 (§3-4) |
| 머천트 Purchases / Email / User ID 를 조건 없이 Yes·Linked | 앱은 설정 화면에서 웹 머천트 페이지로 나가는 `Link` 하나만 갖는다(`SettingsView.swift`). 인앱 OAuth·인앱 결제 코드가 없고, 결제는 아직 개시되지 않았다(`wrangler.toml`의 `TOSS_CLIENT_KEY`는 토스 공개 문서용 테스트 키). | 조건부 항목으로 §5에 분리 |

---

## 1. Data Collection 전체 여부

**"Do you or your third-party partners collect data from this app?"** → **Yes**

앱이 서버로 보내고 서버가 요청 처리 이후까지 보관하는 값이 실제로 있다(APNs 토큰과 익명 기기 식별자, 사용 집계 카운터, 오류 신고 메모). Apple 기준의 "collect"는 단말 밖으로 전송하고 요청 처리에 필요한 시간을 넘겨 보관하는 것이므로 Yes다.

---

## 2. 이 앱이 쓰는 식별자와 그 성격

이후 항목의 Linked 판단이 전부 여기에 걸려 있으므로 먼저 정리한다.

- **익명 기기 식별자** — `AnonymousDeviceStore.deviceID()`가 최초 1회 `UUID().uuidString`을 만들어 `UserDefaults`에 저장하고 계속 재사용한다. 앱을 지우면 사라진다. 광고 식별자(IDFA)가 아니고, 다른 앱·다른 회사와 공유하지 않는다.
- **APNs 기기 토큰** — 시스템이 발급한다. 알림 발송에만 쓴다.
- **계정이 없다.** 앱에는 로그인·회원가입·이메일 입력이 없다. 이름·연락처·계정 식별자를 수집하는 코드 경로가 존재하지 않는다.

그래서 이 문서의 모든 항목은 **Data Not Linked to You**(사용자 신원에 연결하지 않음)로 답한다. 근거는 "수집한 값 중 특정 개인을 지목할 수 있는 것이 하나도 없고, 그 값들을 사람 신원과 이어 붙일 계정 체계 자체가 없다"는 점이다.

> 이 판단이 뒤집히는 조건: 앱에 계정이 생기거나, 머천트 계정과 위 기기 식별자를 서버에서 조인하는 코드가 생기면 그 순간부터 해당 항목은 전부 **Linked = Yes**로 바꿔야 한다. 현재 서버 스키마 어디에도 `userId` 필드가 남아 있지 않다(검색 기록 스키마와 함께 삭제).

---

## 3. App Store Connect에서 **선택할** 데이터 유형

App Store Connect → 앱 개인정보 → "앱이 수집하는 데이터"에서 아래 4개만 체크한다. 각 항목마다 (1) 고를 데이터 유형, (2) 수집 목적, (3) 사용자 신원 연결 여부, (4) 추적 사용 여부, (5) 세부 옵션을 적었다.

### 3-1. Location → Precise Location (정확한 위치)

| 질문 | 답 |
| --- | --- |
| 선택할 데이터 유형 | **Location → Precise Location** |
| 수집 목적 | **App Functionality** (앱 기능) 하나만 |
| 사용자 신원과 연결 | **아니요** (Data Not Linked to You) |
| 추적에 사용 | **아니요** |
| 세부 옵션 | 목적 체크박스는 App Functionality만. Analytics·Product Personalization·Third-Party Advertising·Developer's Advertising or Marketing·Other Purposes는 모두 해제 |

무엇을 보내는가: 사용자가 위치 권한을 허용한 경우의 현재 좌표를 주변 주차장·축제·공연 조회 요청의 쿼리 파라미터(`lat`, `lng`, `radiusMeters`)로 보낸다. 권한 키는 `NSLocationWhenInUseUsageDescription` 하나뿐이고(`AppInfo.plist`), Always 권한 키가 없다.

**요청 좌표가 어디에도 저장되지 않는다는 근거** (2026-09-10 코드 전수 확인):

- Worker의 `INSERT INTO` 대상 테이블은 `agent_activity`, `akei_trade_expos`, `analytics_daily`, `city_festivals`, `discovery_items`, `event_reports`, `geocode_cache`, `local_events`, `merchants`, `notification_devices`, `parking_lots`, `realtime_parking_status`, `sync_runs` 열세 개다. 이 중 요청의 `lat`/`lng`를 바인딩하는 문장은 하나도 없다.
- 요청 좌표는 `queryFestivalsFromCache` / 주변 조회·클러스터 핸들러의 **읽기 조건**으로만 들어가고, 응답 본문에 `destination: { lat, lng, radiusMeters }`로 되돌아 나올 뿐이다.
- `geocode_cache`는 사용자 좌표가 아니라 **행사 주소·장소명 문자열**(`query` 컬럼)로 키를 잡는다(`worker-backend/src/geocodeStore.ts`). 채우는 경로는 admin 로컬 이벤트 생성과 cron 지오코딩 backfill뿐이다.
- `notification_devices`에는 좌표 컬럼 자체가 없다(`device_id`, `apns_token`, 지역 키 문자열, 카테고리, 방해 금지 시간). 관심 지역은 `"서울|중구"` 같은 행정구역 문자열이지 좌표가 아니다.
- `POST /api/analytics`는 allowlist에 있는 이벤트·라벨만 받고, `api_error`는 요청 URL을 라벨로 쓰지 않는다 — 좌표가 들어갈 자리가 없다.
- `app.onError`는 `console.error(error)`만 하고 요청 URL을 찍지 않는다.

**그럼에도 Yes로 선언한다.** 이유는 하나다: `worker-backend/wrangler.toml`의 `[observability] enabled = true`, `head_sampling_rate = 1`이 Workers Logs에 **요청 URL을 포함한 invocation 로그를 보존**한다. 주변 조회 요청 URL에는 `lat`/`lng`가 쿼리 파라미터로 들어 있으므로, 애플리케이션 DB에는 없어도 플랫폼 로그에는 요청 처리 시간을 넘겨 남는다. Apple의 "request 처리보다 오래 보관되면 collection" 기준을 그대로 적용하면 이것은 collection에 해당한다. 매니페스트와 App Store Connect 양쪽 모두 **Precise Location = Yes / Linked No / Tracking No / App Functionality**를 유지하는 것이 맞다.

관측 로그를 끄고(`enabled = false`) 좌표를 body로 옮기는 등 로그에서 좌표를 빼면 그때 다시 판단할 수 있지만, 운영 디버깅을 잃는 대가이고 과소 신고 위험이 훨씬 크므로 지금은 바꾸지 않는다.

### 3-2. Identifiers → Device ID (기기 ID)

| 질문 | 답 |
| --- | --- |
| 선택할 데이터 유형 | **Identifiers → Device ID** |
| 수집 목적 | **App Functionality** 하나만 |
| 사용자 신원과 연결 | **아니요** |
| 추적에 사용 | **아니요** |
| 세부 옵션 | 같은 Identifiers 카테고리의 **User ID는 체크하지 않는다** (§5 참고). 목적은 App Functionality만 |

무엇을 보내는가: 알림을 켜면 `NotificationRegistrationService.register`가 `POST /api/notifications/register`로 아래를 보낸다.

- `deviceId` — 앱이 만든 익명 UUID
- `apnsToken` — APNs 기기 토큰 (hex)
- `apnsEnvironment` — `"sandbox"`(Debug) 또는 `"production"`(Release)
- 알림 설정 — 종류별 on/off, 관심 지역, 카테고리, 방해 금지 시간

서버는 `notification_devices` 테이블에 이 행을 보관하고, cron이 D-30/D-7/D-1 알림을 그 토큰으로 보낸다. 즉 이 항목은 **보관되는 수집**이 맞고, 이전 문서의 "푸시 토큰 미수집" 서술은 틀렸다.

Apple의 Device ID 정의는 IDFA뿐 아니라 "앱이 생성한 기기 단위 식별자"도 포함하므로, IDFA를 안 쓰더라도 이 항목은 Yes다.

### 3-3. Usage Data → Product Interaction (제품 상호작용)

| 질문 | 답 |
| --- | --- |
| 선택할 데이터 유형 | **Usage Data → Product Interaction** |
| 수집 목적 | **Analytics** (분석) 하나만 |
| 사용자 신원과 연결 | **아니요** |
| 추적에 사용 | **아니요** |
| 세부 옵션 | 같은 Usage Data 카테고리의 **Advertising Data와 Other Usage Data는 체크하지 않는다.** 목적에서 App Functionality도 해제 — 이 값 없이도 앱은 정상 동작하므로 Analytics만 남긴다 |

무엇을 보내는가: `AnalyticsService`가 아래 13개 이벤트 이름과(일부는 라벨과) **발생 횟수만** 메모리에 모아 두었다가, 앱이 백그라운드로 갈 때 `POST /api/analytics`로 한 번에 보낸다.

`app_open`, `map_loaded`, `event_pin_tap`, `event_detail_open`, `favorite_add`, `calendar_open`, `notification_open`, `parking_view`, `navigation_start`, `report_submit`, `merchant_register_tap`, `empty_result`, `api_error`

이 전송에 **기기 식별자·세션 식별자·좌표·검색어가 들어가지 않는다** (`AnalyticsService.Entry`는 `name`/`label`/`count` 세 필드뿐이다). 서버는 `analytics_daily` 테이블에 `(날짜, 이벤트, 라벨)` 카운터만 올리므로 개별 이용자의 행동 이력으로 복원되지 않는다. `api_error`는 요청 URL에 좌표가 들어 있어 경로를 라벨로 쓰지 않는다.

전송은 fire-and-forget이고 실패하면 조용히 버린다. UI 테스트(`-uiTesting`) 실행 시에는 아예 꺼진다.

### 3-4. User Content → Other User Content (기타 사용자 콘텐츠)

| 질문 | 답 |
| --- | --- |
| 선택할 데이터 유형 | **User Content → Other User Content** |
| 수집 목적 | **App Functionality** 하나만 |
| 사용자 신원과 연결 | **아니요** |
| 추적에 사용 | **아니요** |
| 세부 옵션 | 같은 User Content 카테고리의 Emails or Text Messages·Photos or Videos·Audio Data·Gameplay Content·Customer Support는 모두 체크하지 않는다 |

무엇을 보내는가: 행사 상세 화면의 "정보에 문제가 있나요?"에서 여는 `EventReportSheet`이 `POST /api/event-reports`로 `eventKind`, `eventId`, `eventTitle`, `reason`(7종 중 하나), 그리고 **선택 입력 메모**를 보낸다. 이 메모가 사용자가 자유롭게 쓰는 텍스트라 이 항목에 해당한다.

서버 스키마(`eventReportSchema`)가 그 외 필드(기기 id, 이메일 등)를 파싱 단계에서 버리므로 신고자 식별 정보는 저장되지 않는다. 같은 기기의 반복 신고 억제는 서버가 아니라 기기 `UserDefaults`(`eventReports.submitted`)에서 한다. 시트 UI에도 "개인정보(이름, 연락처 등)는 적지 말아 주세요"라는 안내가 있다.

**공유 확장은 여기에 해당하지 않는다.** `ShareViewController`는 받은 텍스트를 정리해 App Group `UserDefaults`(`sharedDestinationDraft`)에 저장하고, 앱이 `SharedDestinationStore.consume`으로 읽으면서 지운다. 단말 밖으로 나가는 경로가 없다.

---

## 4. **선택하지 않을** 항목 (No에 체크)

| 카테고리 | 이유 |
| --- | --- |
| Contact Info (Name / Email / Phone / Address / Other) | 앱에 계정·문의 폼·입력 필드가 없다. 머천트 이메일은 §5 참고 |
| Health & Fitness | 관련 프레임워크·코드 없음 |
| Financial Info (Payment / Credit / Other) | 인앱 결제 코드가 없다. 카드 정보는 어떤 경로로도 앱에 들어오지 않는다 |
| Sensitive Info | 해당 없음 |
| Contacts | 연락처 프레임워크 미사용 |
| User Content → Photos or Videos / Audio Data / Emails or Text Messages / Gameplay Content / Customer Support | 앱이 사진·오디오·메시지를 읽거나 보내지 않는다 |
| Browsing History | 웹 브라우징 이력을 만들지도 보내지도 않는다 |
| **Search History** | **검색어·선택한 목적지를 서버로 보내던 `POST /analytics/search-history` 전송을 앱·Worker·backend에서 모두 제거했다.** 지도 검색의 "최근 찾아본" 목록은 기기 `UserDefaults`에만 남는 로컬 기능이라 수집이 아니다 |
| Identifiers → User ID | 계정이 없다 (§5 참고) |
| Purchases → Purchase History | 인앱 구매·인앱 결제 없음 (§5 참고) |
| Usage Data → Advertising Data / Other Usage Data | 광고 SDK 없음. 집계는 §3-3의 Product Interaction 하나로 끝난다 |
| **Diagnostics → Crash Data / Performance Data / Other Diagnostic Data** | **저장소에 Sentry·Crashlytics·Firebase 등 어떤 진단 SDK도 없다.** SPM 의존성은 `KakaoMapsSDK`, `KakaoOpenSDK` 둘뿐이고, 크래시·성능 지표를 서버로 보내는 코드가 없다. 이전 문서가 "도입 시"를 전제로 Yes로 적어 둔 것이라 실제와 달랐다 |
| Location → Coarse Location | 좌표를 흐리게 만들어 보내는 경로가 없다. 정확한 위치 한 항목으로 답한다 |
| Other Data | 위 4개 밖에 해당하는 전송이 없다 |

Apple이 제공하는 진단 데이터(App Store Connect의 Xcode Organizer 지표)는 개발자가 앱에서 수집하는 것이 아니므로 이 질문지의 대상이 아니다.

---

## 5. 머천트(웹) 관련 항목 — 앱에서는 선택하지 않는다

이전 문서는 머천트 결제·이메일·OAuth 식별자를 앱의 수집 항목으로 Yes·Linked 처리했다. 현재 코드 기준으로는 다르다.

- 앱에는 머천트 로그인·결제 화면이 없다. `SettingsView`가 `AppConfiguration.current.apiBaseURL.appendingPathComponent("merchant")` 주소를 SwiftUI `Link`로 여는 것이 전부다. 즉 **사용자가 외부 웹 페이지로 나가서** 거기서 OAuth 로그인과 결제를 한다.
- 결제는 아직 개시되지 않았다. `wrangler.toml`의 `TOSS_CLIENT_KEY`는 토스페이먼츠 공개 문서의 테스트 키이고, 가맹점 가입은 보류 상태다.

권장 답변: **앱 개인정보 질문지에서는 Purchases·Contact Info·Identifiers → User ID를 모두 No로 둔다.** 앱 바이너리에 그 데이터를 수집하는 코드가 없기 때문이다.

단, 웹 머천트 서비스가 실제로 운영을 시작하면(실 결제 키 전환, 가맹점 가입 완료) 다시 판단해야 한다. Apple 질문지는 "앱과 연결된 서비스에서 수집하는 데이터"를 묻기 때문에, 같은 운영주체가 앱에서 유도한 웹 흐름에서 이메일·OAuth 식별자·결제 이력을 보관하기 시작하면 그 시점에 아래로 바꾼다.

- Contact Info → Email Address: Yes / App Functionality / **Linked Yes** / Tracking No
- Identifiers → User ID: Yes / App Functionality / **Linked Yes** / Tracking No
- Purchases → Purchase History: Yes / App Functionality + Other Purposes(법정 보관) / **Linked Yes** / Tracking No

이 전환 시점을 놓치지 않도록, 토스 가맹점 가입 작업과 이 문서를 같이 묶어 두는 것이 좋다.

---

## 6. 추적(Tracking) 답변

**"Does this app use data for tracking?"** → **No**

- 광고 SDK·어트리뷰션 SDK가 없다. 서드파티 SDK는 카카오 지도와 카카오 내비 두 개뿐이고, 둘 다 지도 표시와 길안내 실행용이다.
- 다른 회사의 앱·웹사이트 데이터와 결합하거나, 데이터 브로커에 넘기는 코드가 없다.
- 매니페스트도 `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains`는 빈 배열이다.
- 따라서 **ATT(App Tracking Transparency) 프롬프트가 필요 없다.** `AppTrackingTransparency` 프레임워크를 import 하는 코드도 없다.

---

## 7. `PrivacyInfo.xcprivacy`와의 대조

App Store Connect 답변과 앱에 동봉되는 매니페스트가 어긋나면 심사에서 지적된다. 이번 갱신 후 두 문서는 아래처럼 1:1로 맞는다.

| 이 문서 §3 | `PrivacyInfo.xcprivacy` 항목 | Linked | Tracking | Purposes |
| --- | --- | --- | --- | --- |
| 3-1 Precise Location | `NSPrivacyCollectedDataTypePreciseLocation` | false | false | AppFunctionality |
| 3-2 Device ID | `NSPrivacyCollectedDataTypeDeviceID` | false | false | AppFunctionality |
| 3-3 Product Interaction | `NSPrivacyCollectedDataTypeProductInteraction` | false | false | Analytics |
| 3-4 Other User Content | `NSPrivacyCollectedDataTypeOtherUserContent` | false | false | AppFunctionality |

`NSPrivacyTracking = false`는 §6과 일치한다. 매니페스트는 앱 타깃의 `Resources` 디렉터리에 들어 있어(`project.yml:35`) 앱 번들에 동봉된다. 공유 확장과 위젯 타깃은 `Resources`를 소스에 넣지 않으므로 각자의 매니페스트가 없는데, 두 확장 모두 네트워크 전송이 없어 별도 신고 대상이 아니다.

접근 API 사유(`NSPrivacyAccessedAPITypes`)도 현재 코드와 맞는다: `UserDefaults` CA92.1(앱·App Group 저장), FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1.

### 이전 갱신에서 남겨 두었던 불일치 — 이번에 해소함

2026-09-10 문서 갱신 때 코드 수정이 필요해 미뤄 두었던 두 가지를 이번에 코드로 처리했다.

1. **`/legal/privacy`(공개 개인정보처리방침)와 검색 기록 전송의 충돌** — 방침의 "위치정보: 단말 외부에 영구 저장하지 않으며, 요청 처리 시 1회성으로 사용 후 폐기합니다"가 목적지 좌표를 익명 기기 식별자와 함께 보관하는 동작과 어긋났다. 권장안대로 **전송 자체를 제거**했다. 방침은 애초에 검색 기록을 수집 항목으로 적은 적이 없고, 전송이 사라진 지금 위 문구가 다시 사실이 되므로 `worker-backend/src/legal/routes.ts`는 **고칠 것이 없다.**
2. **인증 없이 열려 있던 `GET /analytics/search-history`와 `/analytics/search-history/stats`** — 두 라우트를 `POST /analytics/search-history`와 함께 삭제했다. Worker에 남은 인증 없는 조회 엔드포인트는 `/discover/pipeline-stats`, `/agent-office/activity`, `/discover/providers/health`, `/parking/providers/health` 넷인데 모두 앱 화면이 직접 호출하는 기능이고, 개인 데이터가 아닌 집계 수치만 돌려준다. 예외 문자열이 섞일 수 있는 두 곳(`pipeline-stats`의 `sync_runs.message`, `discover/providers/health`의 provider 메시지)은 admin 토큰이 없으면 이미 가려진다.

## 8. 데이터 보호 관련 사실 (참고)

- 모든 외부 통신은 HTTPS다. App Transport Security 예외를 여는 키가 `AppInfo.plist`에 없다.
- 위치 권한은 사용 중일 때만(`NSLocationWhenInUseUsageDescription`)이고 Always 권한을 요청하지 않는다.
- `UIBackgroundModes`는 `["fetch"]` 하나이며 `remote-notification`이 없다. 즉 백그라운드 푸시로 조용히 깨어나 데이터를 모으는 경로가 없고, 알림은 사용자에게 보이는 형태로만 도착한다. 백그라운드 갱신은 `BGTaskSchedulerPermittedIdentifiers = ["com.parkingnav.discovery.refresh"]` 하나로 기존 공개 API만 조회한다.
- APNs 토큰은 App Group `UserDefaults`의 `apnsDeviceToken` 키에 저장한다. `NotificationRegistrationService`가 직전 전송본과 같은 payload면 재전송하지 않는다.
- 알림 발송 이력(`notification_digests`)은 30일 후 자동 삭제된다. 익명 집계는 `ANALYTICS_RETENTION_DAYS` 기준으로 정리된다.
- 공유 확장이 받은 텍스트는 앱이 소비하는 즉시 App Group 저장소에서 지워진다.

---

## 9. 함께 등록할 URL

| 항목 | URL |
| --- | --- |
| Privacy Policy | `https://parking-lot-navigator-api.parkingnav.workers.dev/legal/privacy` |
| Terms of Service | `https://parking-lot-navigator-api.parkingnav.workers.dev/legal/terms` |
| Refund Policy (머천트) | `https://parking-lot-navigator-api.parkingnav.workers.dev/legal/refund-policy` |
| Support URL | **미정 — App Store Connect 필수 필드다.** |
| Marketing URL | (선택, 미정) |

세 법적 페이지는 현재 Worker 기본 도메인에서 서빙된다(`worker-backend/src/index.ts`의 `app.route("/legal", createLegalApp())`). 커스텀 도메인을 붙이면 이 표의 호스트를 함께 바꾼다.

Support URL은 출시 전에 반드시 결정해야 한다. `mailto:`도 허용되지만 심사에서 실제 응답 가능한 창구인지 확인받을 수 있으므로, 가능하면 `/legal` 아래에 문의 안내 페이지를 하나 두는 편이 안전하다.
