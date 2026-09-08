# 사용한 자산의 출처

이 영상에는 **실제 앱 실행 화면 캡처가 한 장도 들어 있지 않다.**
이 저장소에는 실행 화면 스크린샷이 없고, 작업 환경(WSL)에 Xcode/Swift 툴체인이 없어
앱을 빌드해 캡처할 수 없었기 때문이다. 그래서 앱 화면이 나오는 구간은
SwiftUI 뷰 구조를 그대로 옮긴 **구성도**로 그렸고, 그 구간 내내 화면 오른쪽 위에
`SwiftUI 뷰 구조를 옮긴 구성도 · 실행 화면 캡처 아님` 배지를 띄워 둔다.

## 1. 저장소에서 그대로 가져온 이미지 (원본 그대로, 바이트 동일)

| 영상 내 파일 | 저장소 원본 | 쓰인 곳 |
|---|---|---|
| `assets/img/app-icon.png` | `ios-app/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | S1, S10 |
| `assets/img/pin-01-music-concert.png` | `design/map-pins/01-music-concert.png` | S2 지도 핀 |
| `assets/img/pin-02-food-festival.png` | `design/map-pins/02-food-festival.png` | S2 |
| `assets/img/pin-02-calendar-event.png` | `design/map-pins/02-calendar-event.png` | S5 |
| `assets/img/pin-03-night-fireworks.png` | `design/map-pins/03-night-fireworks.png` | 예비 |
| `assets/img/pin-05-exhibition-art.png` | `design/map-pins/05-exhibition-art.png` | S2 |
| `assets/img/pin-05-parking.png` | `design/map-pins/05-parking.png` | S2, S5 |
| `assets/img/pin-06-family-kids.png` | `design/map-pins/06-family-kids.png` | 예비 |
| `assets/img/pin-07-local-event-map.png` | `design/map-pins/07-local-event-map.png` | S2 |
| `assets/img/pin-07-traditional-culture.png` | `design/map-pins/07-traditional-culture.png` | 예비 |
| `assets/img/pin-08-current-location.png` | `design/map-pins/08-current-location.png` | S2 현재 위치 |

전부 `cmp`로 원본과 바이트 단위 동일함을 확인했다. 영상용으로 다시 그리거나 보정한 이미지는 없다.

## 2. 이 영상을 위해 새로 그린 화면 (실행 화면 아님)

| 대상 | 무엇인가 | 근거로 삼은 코드 |
|---|---|---|
| S2 지도 화면 | 지도 · 검색바 · 카테고리 칩 · 하단 탭 4개를 HTML/CSS로 재현한 구성도 | `ios-app/Features/Map/MapHomeView.swift` |
| S3 행사 상세 | 헤더 이미지 영역 · 제목 · 상태/카테고리/요금 칩 · 기간·장소·요금 표 · 프로그램 · 신고 링크 | `ios-app/Features/ParkingResults/ParkingResultsView.swift`, `EventReportSheet.swift` |
| S4 캘린더 | 월 달력 격자 + 날짜별 행사 목록 | `ios-app/Features/Calendar/CalendarTabView.swift` |
| S5 주변 주차 | 지도 + 주차장 목록 + 길안내 버튼 | `ios-app/Features/ParkingResults/NearbyParkingMapView.swift` |
| S7 파이프라인 도식 | 소스 → 처리 4단계 → 저장/제공 3열 도식 | `worker-backend/src/` 각 모듈 |

**구성도 안의 텍스트 데이터는 전부 예시다.** 행사 이름(`한강 가을 야시장 & 거리공연 페스티벌`,
`서울 국제 도서전` 등), 주차장 이름, 잔여 면수, 날짜는 화면 레이아웃을 보여주기 위해 만든
가상의 값이며 실제 수집 데이터가 아니다. 이 값들은 화면 구성 요소일 뿐 영상에서
"수집된 데이터"라고 주장하지 않는다.

## 3. 폰트

| 파일 | 서체 | 라이선스 | 용도 |
|---|---|---|---|
| `assets/fonts/Pretendard-Regular.woff2` / `-SemiBold` / `-Bold` | Pretendard | SIL Open Font License 1.1 | 본문·제목 전체 |
| `assets/fonts/JetBrainsMono-400.woff2` / `-700.woff2` | JetBrains Mono | SIL Open Font License 1.1 | 파일 경로·코드 |

둘 다 OFL이라 임베드해 배포할 수 있다. 작업 환경에 한글 폰트가 하나도 설치돼 있지 않아
(`fc-list :lang=ko` 결과 0개) 웹폰트를 번들해 `@font-face`로 로드한다.
JetBrains Mono에는 한글 글리프가 없어 mono 스택은 `JBMono, Pretendard, monospace` 순서다.
코드 박스에서는 `font-variant-ligatures:none`을 걸어 `<=`가 `≤`로 합쳐지지 않게 했다 —
실제 SQL 원문과 다르게 보이면 안 되기 때문이다.

## 4. 쓰지 않은 것

- 스톡 사진, 스톡 영상, AI로 생성한 이미지: **없음**
- BGM · 효과음: **없음** (무음 트랙조차 넣지 않았다)
- 외부 로고(Cloudflare, Apple, 데이터 제공기관): **없음** — 이름만 텍스트로 적었다
- 실제 앱 실행 화면 캡처: **없음** (위 사유)
