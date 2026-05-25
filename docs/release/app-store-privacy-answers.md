# App Store Connect — App Privacy 질문지 답변 초안

대상: 이벤트다 (`ParkingLotNavigator`) iOS 1.0 (build 132+)
작성일: 2026-05-25
근거 파일: `ios-app/Resources/PrivacyInfo.xcprivacy`, Worker `/legal/privacy`

이 문서는 App Store Connect → App Privacy 섹션 입력 시 그대로 옮겨 적을 수 있도록 정리한 초안입니다. 실제 입력은 App Store Connect 웹 UI에서 진행합니다.

---

## 1. Data Collection 전체 여부

**"Do you or your third-party partners collect data from this app?"** → **Yes**

이유: 위치(앱 기능용), 진단(크래시/성능), 머천트 결제 처리(외부 위탁) 데이터를 처리합니다.

---

## 2. 수집 데이터 항목별 답변

각 데이터 타입에 대해 (a) 수집 여부, (b) 사용자에게 연결(Linked) 여부, (c) 트래킹(Tracking) 사용 여부, (d) 사용 목적을 답변합니다.

### Location → Precise Location

- 수집: **Yes**
- Linked to User: **No** (계정 없이 위치만 일시 사용)
- Used for Tracking: **No**
- Purpose: **App Functionality** (주변 이벤트/주차장 추천)

### Diagnostics → Crash Data

- 수집: **Yes** (Sentry/Crashlytics 도입 시 — 도입 완료 후 켜기)
- Linked to User: **No**
- Used for Tracking: **No**
- Purpose: **App Functionality**

### Diagnostics → Performance Data

- 수집: **Yes**
- Linked to User: **No**
- Used for Tracking: **No**
- Purpose: **App Functionality**

### Purchases → Purchase History (머천트 결제 한정)

- 수집: **Yes** (앱이 아니라 웹 머천트 페이지에서 발생하지만, 동일 운영주체가 수집)
- Linked to User: **Yes** (네이버/카카오 OAuth 식별자에 연결)
- Used for Tracking: **No**
- Purpose: **App Functionality, Other** (전자상거래법 의무 보관)

### Contact Info → Email Address (머천트 한정)

- 수집: **Yes** (OAuth 로그인 시 제공받음)
- Linked to User: **Yes**
- Used for Tracking: **No**
- Purpose: **App Functionality** (머천트 본인 확인, 결제 안내)

### Identifiers → User ID (머천트 한정)

- 수집: **Yes** (네이버/카카오 OAuth subject id)
- Linked to User: **Yes**
- Used for Tracking: **No**
- Purpose: **App Functionality**

### User Content → Other User Content (공유 확장)

- 수집: **Yes** (공유된 주소/장소명/URL — App Group 임시 저장)
- Linked to User: **No**
- Used for Tracking: **No**
- Purpose: **App Functionality**

### 수집하지 않는 카테고리 (No에 체크)

- Health & Fitness
- Financial Info (카드번호 등 — 토스페이먼츠가 직접 처리, 회사 미저장)
- Sensitive Info
- Contacts
- Photos or Videos (머천트 이미지 업로드는 머천트의 사진 라이브러리이며 웹에서 발생)
- Audio Data
- Search History
- Browsing History
- Other Usage Data

---

## 3. 트래킹(Tracking) 사용 여부

**"Does this app use data for tracking?"** → **No**

- 3rd-party 광고 SDK 미사용
- ATT 프롬프트 불필요 (`NSPrivacyTracking = false`)

---

## 4. 데이터 보호 권고 사항

- 위치 데이터는 단말 외부에 영구 저장하지 않음 (요청 단위 1회 사용 후 폐기)
- 모든 외부 통신은 HTTPS (App Transport Security 기본값 유지)
- 머천트 세션 쿠키는 HttpOnly Secure SameSite=Lax
- R2 업로드 머천트 이미지는 EXIF 제거 적용 예정 (P2)

---

## 5. 입력 시 주의

- Sentry/Crashlytics SDK를 실제로 통합한 빌드부터 "Crash Data / Performance Data"를 Yes로 유지합니다. 도입 전 빌드는 No로 변경하세요.
- 머천트 결제는 앱이 아닌 웹에서 발생하지만, App Store Connect Privacy 질문지는 "회사가 수집하는 모든 데이터"를 기준으로 묻기 때문에 위와 같이 Yes로 답합니다.
- "Privacy Policy URL" 필드에는 Worker가 제공하는 공개 URL을 입력합니다: `https://parking-lot-navigator-api.parkingnav.workers.dev/legal/privacy` (또는 향후 도메인 `https://eventda.app/legal/privacy`).

---

## 6. 함께 등록할 URL 모음

| 항목                   | URL                                              |
| ---------------------- | ------------------------------------------------ |
| Privacy Policy         | `/legal/privacy`                                 |
| Terms of Service       | `/legal/terms`                                   |
| Refund Policy (머천트) | `/legal/refund-policy`                           |
| Support URL            | (지정 필요 — 임시: `mailto:support@eventda.app`) |
| Marketing URL          | (선택)                                           |

Support URL은 App Store Connect 필수 필드이므로 출시 전에 별도 결정 필요.
