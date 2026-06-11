# 결정 사항

마지막 업데이트: 2026-06-11

## 제품 방향

- 메인 앱 경험을 실시간 주차에서 로컬 축제/이벤트 발견 중심으로 전환한다.
- 주차 추천은 사용자가 목적지·이벤트·축제를 고른 뒤의 실용적 보조 흐름으로 유지한다.
- 기존 주차 흐름은 보조 경로로 보존한다: 목적지 검색 → 주변 주차장 추천.
- 서울 중심 주차 추천에서 전국 주차 추천으로 계속 확장한다.
- 앱을 목적지 동반자로 만든다: 이벤트/축제/장소를 고른 뒤 지도 맥락을 벗어나지 않고 주변 주차를 비교한다.
- 실시간 주차는 지도 토글로 유지하며 기본값은 꺼짐이다.
- 프로덕션 백엔드로 Cloudflare Worker 를 사용한다.
- 정규화된 주차 데이터와 실시간 캐시는 Cloudflare D1 을 사용한다.
- 지도 발견 컨트롤은 단순하게 유지한다: 모든 이벤트/축제 provider 를 묶는 사용자 노출 토글 하나, 이름은 "이벤트".
- provider/source 구분은 별도 지도 토글이 아니라 데이터와 필터 안에서 유지한다.

## 브랜드/UI 방향

- 티켓 모양의 축제 마스코트를 앱의 대표 캐릭터로 사용한다.
- 마스코트 주도의 빈 상태, 안내/팁 화면, 상세 플레이스홀더, 친근한 발견 순간을 선호한다.
- 마스코트는 맥락에 따라 포즈/형태를 바꿀 수 있지만, 같은 캐릭터임이 분명히 유지되어야 한다.
- Figma 는 디자인 참조 소스이지만, 구현은 SwiftUI 구조를 유지보수 가능하고 앱 네이티브하게 유지해야 한다.
- 시각적 톤은 주차 유틸리티보다 축제/이벤트 가이드처럼 느껴져야 한다.

## 테마 시스템 결정

- 테마는 디자인 토큰 방식으로만 추가한다: 새 테마 = `FestivalTheme` case + 12색 palette. UI 구조/기능 흐름은 바꾸지 않고, 기존 테마의 코드 경로는 그대로 둔다(회귀 0 원칙).
- 크레파스(손그림) 테마는 색뿐 아니라 형태/테두리/그림자/질감/폰트까지 `isHandDrawn` 분기 토큰으로 바꾼다: `cardRadius`/`controlRadius`(computed), `controlShape`/`chipShape`(AnyShape), `Font.festival`/`uiFont`, `FestivalCardBackground` 분기, `paperGrainOverlay`.
- 손그림 외곽선은 시드 고정 결정적(deterministic) jitter 로 그린다(`RoughRoundedRectangle`) — 프레임마다 떨리지 않고 스크롤 재그리기에도 동일해야 한다. 질감은 외부 이미지 없이 `Canvas` 코드로만 만든다.
- 크레파스 손글씨 폰트는 개구쟁이체(Gaegu, SIL OFL)를 `Resources/Fonts/` 에 번들한다(Regular/Bold + OFL.txt). 폰트는 크레파스 테마에서만 활성화되고 다른 테마는 시스템 폰트를 유지한다. 가독성 보정으로 +1pt bump.
- 지도 클러스터 숫자(7~9pt)처럼 가독성이 임계인 초소형 텍스트는 크레파스에서도 시스템 폰트를 유지한다.

## 머천트 웹 페이지 결정

- 머천트 웹 페이지(`/merchant`)는 사용자별 앱 테마를 알 수 없으므로 **앱 기본 테마(허니 옐로) 팔레트로 고정**한다. iOS `FestivalDesign` honey palette 와 CSS 변수(`--festival-*`)를 1:1 로 동기화한다.
- 네이버/카카오 로그인 버튼은 테마와 무관하게 각 브랜드 가이드 색을 유지한다.
- 약관/정책 문서는 본문을 중복 작성하지 않고 기존 `/legal/*` 라우트를 `<dialog>` + iframe 팝업으로 재사용한다.
- 이벤트 등록은 이용약관/개인정보처리방침/환불·취소 정책에 대한 필수 동의를 받는다 — 클라이언트 `required` 체크박스 + 서버 측 `agree_legal` 검증(400) 이중화.

## 데이터 전략

- 모든 앱 요청마다 대형 공공 API 를 직접 호출하지 않는다.
- 전국 정적 주차 데이터를 D1 에 저장한다.
- 빠른 주변 검색에 D1 을 사용한다.
- 지역별 실시간 provider 를 정적/provider 후보 위에 병합한다.
- 폭넓은 후보 커버리지를 위한 fallback 으로 Kakao Local `category_group_code=PK6` 을 사용한다.
- 스크래핑에 앞서 공식 API 를 통해 이벤트/축제 발견을 전국으로 확장한다.
- 현재 발견 소스에는 TourAPI, 전국 문화축제 표준 데이터, 서울 열린데이터, 문화포털, KOPIS, KCISA id 428, KCISA id 196 이 포함된다.
- 사용 가능한 좌표가 없는 행은 설정된 곳에서 sync 중 Kakao Local 로 지오코딩할 수 있다. 해결되지 않은 행은 지도 핀 표시에서 제외된다.
- 여러 공식 목록 API 는 설명이 빈약하다. 가능하면 상위(upstream) 설명을 그대로 보여주고, 없을 때는 생성된 구조화 요약을 보여준다. 상세 API enrichment 는 추후 추가한다.

## 실시간 전략

- 지도 전역 실시간 표시에 D1 실시간 캐시를 사용한다.
- sync 주기 목표: 약 5분.
- 실시간 토글은 현재 viewport 만이 아니라 전국 데이터를 보여줘야 한다.
- 실시간 주차 핀은 숫자형 서버/앱 클러스터 대신 로드된 실시간 주차장 목록에서 렌더링한다.
- 화면상 겹치는 실시간 주차 핀은 축소 상태에서 대표 핀 하나로 합쳐지고, 확대하면 작은 오프셋으로 분리된다.
- 이벤트 상세의 주차 추천은 랭킹 전에 일반 주변 주차와 실시간 주차를 병합해야 한다.
- 실시간 주차가 실패해도 주변 주차 추천은 계속 렌더링되어야 한다.

## 서울 실시간 세부

- `GetParkingInfo` 는 실시간 대수는 있지만 좌표가 없다.
- `GetParkInfo` 는 메타데이터와 일부 좌표가 있다.
- 서울 실시간 provider 는 `PKLT_CD` 로 `GetParkingInfo` 와 `GetParkInfo` 를 병합한다.
- 좌표가 없는 나머지 서울 실시간 행은 대반경 실시간 sync 맥락에서 Kakao 주소 검색을 사용할 수 있다.
- 한강 `TbParkingInfoView` 는 좌표와 수용 대수가 있지만 실시간 가용 면수는 제공하지 않는다.

## 캘린더 & 위젯 결정

- 캘린더는 메인 탭 바의 **새 탭**으로 추가. 탭 순서는 `지도 → 이벤트 → 즐겨찾기 → 캘린더 → 사무실 → 설정`.
- 위젯은 **Medium 사이즈만** 지원 (다가오는 축제 3개 카드). Small/Large 는 v1.1 이후 후보.
- 위젯은 네트워크를 직접 호출하지 않고, 앱이 App Group container 에 저장한 JSON 캐시(`widget_festivals.json`)만 읽는다. 앱은 cold start / foreground / 필터 변경 시 `FestivalSyncService` 로 캐시를 갱신하고 `WidgetCenter.shared.reloadTimelines` 를 호출한다.
- 공유 필터 축은 4종: 지역(시·도), 거리 반경(10/20/50km/무제한), 태그/장르, 진행 상태(진행중/예정). App Group `UserDefaults` 로 저장되어 메인 앱과 위젯이 동일 필터를 본다.
- EventKit 연동(iOS 기본 캘린더 추가 버튼)은 v1 에서 제외하고 v1.1 로 deferred. NSCalendarsUsageDescription, PrivacyInfo 갱신을 함께 다룰 때 도입.
- 위젯 extension Bundle ID 는 `$(APP_BUNDLE_ID).UpcomingFestivalsWidget` 으로 project.yml inline 파생. Codemagic xcconfig 에 별도 변수를 추가하지 않는다 (변수 누락으로 ValidateEmbeddedBinary 가 실패한 사고를 회피).

## iOS 지도 레이어 결정

- 실시간 주차 토글 라벨은 단순해야 하며 주차 심볼을 중복하지 않아야 한다.
- 축제/이벤트 provider 는 "이벤트" 라는 지도 토글 하나로 표시한다.
- 축제/이벤트 레이어는 숫자형 클러스터링을 사용하지 않는다. 실제 핀을 렌더링한다.
- 축제/이벤트 핀은 깊게 확대하기 전까지 제목 라벨을 숨긴다.
- 화면상 겹치는 축제/이벤트 핀은 축소 상태에서 대표 핀 하나로 합쳐지고, 확대하면 작은 오프셋으로 분리된다.
- 지도 하단 패널은 주차 추천과 통합 발견 목록에 탭을 사용한다.
- 발견 목록은 이미 로드된 로컬 데이터로 검색·정렬한다. 기본 정렬은 거리이며 날짜·이름 옵션이 있다.
- 발견 목록의 거리 정렬/표시는 가능할 때 사용자의 현재 위치를 사용하고, 위치를 알기 전에만 provider 거리로 폴백한다.
- 지도 핀 탭과 이벤트 탭 행 탭은 동일한 이벤트 상세 + 주변 주차 추천 화면을 연다.
- 이벤트 탭은 선택될 때만 발견 데이터를 로드하고, 떠난 뒤 언로드하며, SwiftUI 목록/diff 정체를 피하기 위해 20개 단위 페이지로 행을 렌더링한다.

## 빌드/릴리스

- 변경을 커밋할 때 iOS 빌드 번호를 1 올린다.
- TestFlight 업로드 전에 Codemagic 의 publish 로그가 이전 App Store Connect 빌드보다 높은 `Version code` 를 보이는지 확인한다.
- 2026-05-09 의 publish 시도는 App Store Connect 에 이미 빌드 79 가 있는데 업로드한 IPA 의 빌드 번호가 여전히 79 여서 실패했다.
- 이후 publish 시도는 App Store Connect 에 이미 빌드 95 가 있는데 업로드한 IPA 의 빌드 번호가 여전히 95 여서 실패했다.
- 현재 빌드 메타데이터 목표는 `1.0 (167)` (2026-06-11 크레파스 손그림 강화 반영, Codemagic 검증 대기).
- iOS 빌드 검증에는 Codemagic/TestFlight 를 사용한다. Codemagic 코드 사이닝은 **수동(Manual)** 방식이며, 새 app extension target 추가 시 별도 distribution provisioning profile 을 발급해 업로드해야 한다.
- 신규 app extension 추가 시 체크리스트: ① Apple Developer Portal 에서 App ID 등록 ② App Groups capability 의 **Configure 버튼**으로 기존 그룹에 명시 매핑 (체크박스만 켜는 것은 부족) ③ 동일 distribution certificate 로 provisioning profile 발급 후 Codemagic Provisioning profiles 슬롯에 업로드 ④ project.yml 에서 Bundle ID 를 `$(APP_BUNDLE_ID).XXX` 형태로 inline 파생.
- GitHub Actions 도 push 와 pull request 에서 iOS 시뮬레이터 검증 workflow 를 실행한다.
- 백엔드 테스트는 CI/Codemagic 에서 실행된다.
- 로컬 Windows 환경에는 `node`, `npm`, `swift`, `xcodebuild` 가 없을 수 있다.
