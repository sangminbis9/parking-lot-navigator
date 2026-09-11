# App Store 스크린샷

출처: `.github/workflows/ios-screenshots.yml` 수동 실행 (run `34614345570`, master `8054ae5`, 2026-09-11).
macOS 러너의 iPhone 16 Pro Max 시뮬레이터에서 `AppStoreScreenshotTests`가 캡처했고,
`simctl status_bar override`로 상태바를 9:41 / 100% / 신호 최대로 고정했다.

모두 **1320×2868, 8-bit RGB, sRGB, 알파 채널 없음** — App Store Connect의 6.9" 디스플레이 규격을 그대로 만족한다.
현재 Apple 요구사항은 6.9" 1장 이상이며, 6.5"는 6.9"를 제출하지 않을 때만 필요하다.

| 파일 | 화면 | 제출 판단 |
| --- | --- | --- |
| `01-map.png` | 지도 탭 — 서울 전역 핀 클러스터, 카테고리 필터 칩 | 사용 가능 |
| `02-discover.png` | 행사 목록 — 2,737건, 썸네일·상태 배지 | 상단 3개 행의 기간 표기가 비정상(아래 참고) |
| `03-detail.png` | 행사 상세 — 포스터, 요금 배지, 공연시간·출연·제작진 | 주소 필드가 비어 있음(아래 참고) |
| `04-detail-scrolled.png` | 행사 상세 하단 — **주변 주차장 추천**(점수·거리·잔여면·공영/교통약자 배지) | 앱의 핵심 가치가 가장 잘 보이는 장면 |
| `05-calendar.png` | 캘린더 탭 — 날짜별 건수 도트, 선택일 어젠다 | 사용 가능 |

즐겨찾기 탭은 새 시뮬레이터라 빈 상태로만 찍혀 제외했다.

## 제출 전에 알고 있어야 할 것

두 가지는 캡처 문제가 아니라 원본 데이터 문제이고, 스크린샷에 그대로 보인다.

- `02-discover.png`, `03-detail.png`의 기간이 `2014-09-11 - 2026-11-30`처럼 10년이 넘는다.
  KOPIS 원본이 장기 상설 공연의 시작일을 최초 개막일로 주기 때문이다.
- `03-detail.png`의 주소 필드가 비어 있다. 해당 KOPIS 항목에 주소가 없다.

둘 다 고친 뒤 다시 캡처하는 편이 낫지만, 제출을 막지는 않는다.
급하면 `04-detail-scrolled.png`와 `01-map.png`, `05-calendar.png`만으로도 제출 요건(6.9" 1장 이상)은 충족한다.

## 다시 뽑는 법

GitHub Actions → **App Store Screenshots** → **Run workflow**.
"Re-run jobs"는 원래 커밋을 다시 돌리므로 새 코드가 반영되지 않는다 — 반드시 Run workflow를 쓴다.
