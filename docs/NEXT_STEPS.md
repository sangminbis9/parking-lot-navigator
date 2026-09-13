# 다음 단계

마지막 업데이트: 2026-09-13

## 진행 중: 변경 기반 발행으로 교체 (09:00 재개)

- D1 0032 및 Worker `6890b1c5-e3d9-4a62-92e1-565e009ae939` 운영 반영 완료. 최초 전체 발행 진행 중이며 완성 manifest/모든 파일 검증이 먼저다.
- 이후 변경 묶음만 발행, 앱 활성 화면 60초 버전 검사/주차 현재 영역 45초 확인을 Codemagic에서 검증하고 TestFlight 업로드한다. 실기기 메모리·오프라인 검증은 별도다.
- 기존 Worker URL 전달 방식은 사용자 승인 범위다. R2 직접 CDN/유료 플랜/추가 권한은 이번에 변경하지 않는다. 아래의 일일 발행 일정 및 마이그레이션 없음 기록은 이전 설계의 이력이다.

## 우선 작업: 스냅샷 배포 (2026-09-13)

1. R2 생성/Worker 배포 완료. 첫 발행은 128개 처리 후 D1 무료 일일 읽기 한도로 중단. 09:00 KST 초기화 후 재발행 → manifest 및 모든 파일 검증. 자동 일정은 10:07 시작/10:17·10:37 복구 확인. 새 D1 마이그레이션은 없다.
2. 사용자 승인으로 기존 Worker 주소를 우선 사용한다. 별도 `DISCOVERY_SNAPSHOT_BASE_URL` 없이 동작한다. R2 커스텀 도메인/CDN 직접 제공은 추후 확장 항목이며 Worker 요청 한도는 아직 남는다.
3. Mac/Codemagic: iOS 테스트·빌드 및 실기기 최초 다운로드 크기/시간/메모리, 오프라인/삭제/공연/주차/위젯 회귀 확인 후 TestFlight 배포.
4. 운영 관찰: 새 앱 지도 탐색 D1 읽기 0 확인, 구버전 앱·수집 작업 D1 사용량 분리, R2 저장량/Queue 여유 감시. 서버 해시 파일 GC는 활성 파일 보존 설계 후 별도 구현한다.

구현 `301145c`, CI/문서 `af9f391`을 `codex/discovery-snapshot-rollout`에 커밋·푸시했다. Codemagic 시뮬레이터 빌드 `6aa57dd96c12c2db73677831` 성공: 단위 92개, 핵심 UI 4개 통과 / 행사 상세·즐겨찾기 1개 skip. Worker `7e4f6977-9822-4c2d-85ea-1534ff072c53`은 운영 배포됐지만 첫 완성 데이터가 없어 TestFlight를 보류했다. CLI 인증 복구 완료, 유료 업그레이드 없음. master 반영 전 기존 배포 workflow의 D1 smoke/수집 워밍업 비용도 확인한다. [구체적인 배포 절차와 한계](architecture/discovery-snapshots.md)를 따른다. 이하의 기존 배포 기록은 이전 시점의 기록이다.

## 현재 상태

- 브랜치: `master`
- 마지막으로 push 된 커밋: `53243a7 Show the discover spinner only on cold start, not on map-pan refreshes`
- 제품 방향은 축제/이벤트 발견 우선이며, 주차/실시간은 선택한 목적지 방문을 보조하는 역할이다. 여기에 머천트용 유료 로컬 이벤트 등록 퍼널이 더해진다.
- iOS 빌드 번호는 `ios-app/project.yml` 에서 `1.0 (286)`. Codemagic 빌드 후 TestFlight 제출 대기 중.
- Worker 프로덕션 배포 완료: 버전 `7e048884` 운영 중.
- D1 마이그레이션 0001–0014 원격 DB 모두 적용 완료. `apply-d1-migrations.yml` workflow 도 0014 까지 포함.
- 오픈 기념 무료 프로모(`MERCHANT_LAUNCH_PROMO_FREE`)가 기본 활성 상태 — 머천트 이벤트 등록 무료.

## 최근 완료 (2026-06-24)

| 작업 | 결과 | 커밋 |
| ---- | ---- | ---- |
| 두-패스 로컬 이벤트 발견: Phase 1 Naver 전체 수집 → Phase 2 Kakao dedup | 완료 | `b511932` |
| `localEvents.ts` 만료 이벤트 필터 누락 버그 수정 (`end_date >= date('now', '-1 day')` 조건 추가) | 완료 | `74c57fc` |
| `APIClient.swift` 축제 API 경로 수정 (`discover/festivals` → `api/festivals`, 60s edge cache 활용) | 완료 | `74c57fc` |
| 즐겨찾기 별표 버튼 (카드 목록·홀로그램·상세 헤더), 캘린더는 즐겨찾기 축제만 표시 | 완료 | `4c52261` |
| 공유 버튼, 스폰서 배지, 성능 최적화 | 완료 | `786996d` |
| 마스코트 앱 아이콘 | 완료 | `8fba71d` |
| 빌드번호 174 | 완료 | `f3e1e22` |

## 이전 완료 (머천트 + Toss MVP)

머천트/로컬 이벤트 수익화 퍼널의 Phase 1 이 종단 간(end-to-end)으로 안착했다:

| 단계 | 결과 | 커밋 |
| ---- | ---- | ---- |
| 머천트 가입 랜딩 + Naver/Kakao OAuth | 완료 | `13908cd` |
| Kakao client secret 지원 | 완료 | `becadbf` |
| 이벤트 등록 폼, R2 이미지 업로드, 시작일 | 완료 | `52a133e` |
| Toss Payments 위젯 통합 | 완료 | `5b38483` |
| `/api/local-events` 만료 + pending_payment 필터 | 완료 | `a5edbd8` |
| iOS 설정에서 머천트 웹 흐름으로 link-out | 완료 | `c31bf14` |
| CI secret 처리 수정 (versions secret put) | 완료 | `9d8be9d` |
| 크레파스 테마 전면 강화 (Gaegu 폰트 264곳 + 손그림 도형) | 완료 | `dd87743` |
| 머천트 페이지 허니 테마 + 약관 팝업 | 완료 | `f55a2a4` |
| 캘린더 탭 개편 + 커스터마이즈 알림 설정 | 완료 | `3e64067` |
| Worker 60s 엣지 캐시 + 위젯/캘린더 | 완료 | `f3465f2` |

운영 상태:

- `MERCHANT_IMAGES` R2 버킷 생성·바인딩 완료.
- `MERCHANT_SESSION_SECRET`, `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID/SECRET`, `KAKAO_REST_API_KEY` 가 Worker secret 으로 설정됨.
- `TOSS_CLIENT_KEY` (테스트 위젯 키 `test_gck_docs_...`) 는 `wrangler.toml` 에 있고, `TOSS_SECRET_KEY` (`test_gsk_docs_...`) 는 Worker secret 이다. Toss 가맹점 온보딩 후 `live_gck_...` / `live_gsk_...` 로 교체 필요.

## Toss 프로덕션 키 수령 후

차단 외부 항목: 사업자등록증 발급 (2026-05-18 신청). 수령 후:

1. 새 사업자등록으로 Toss Payments 가맹점 가입을 완료한다.
2. **결제위젯 연동 키**를 발급한다 ("API 개별 연동 키"는 **사용하지 않는다**).
3. `worker-backend/wrangler.toml` 의 `TOSS_CLIENT_KEY` 를 `live_gck_...` 로 교체한다.
4. `wrangler.toml` 에 `MERCHANT_LAUNCH_PROMO_FREE = "false"` 를 추가해 무료 프로모를 종료한다.
5. `pnpm -C worker-backend exec wrangler secret put TOSS_SECRET_KEY` 로 `live_gsk_...` 를 설정한다.
6. `pnpm -C worker-backend run deploy`.
7. 개인 카드로 실제 10,000원 테스트 결제를 1회 실행한다. D1 행이 `approved` 로 바뀌고, `paid_until = startDate + 3 months` 이며, `/api/local-events` 가 노출하는지 확인한다.

## iOS 빌드 / 릴리스

- Codemagic/Xcode 빌드는 iOS 파일이 바뀔 때만 필요하다.
- 현재 `CURRENT_PROJECT_VERSION` 은 `286`. 다음 Codemagic/TestFlight 업로드 시 publish 로그의 `Version code` 가 App Store Connect 의 기존 최고 빌드보다 높은지 확인한다.
- App Store Connect Privacy Nutrition Labels: 검색 기록(목적지명 + 익명 랜덤 UUID)을 analytics 용도로 수집하므로 "기타 사용 데이터 - 앱 기능" 항목 선택 권장.
- "내 가게 이벤트 등록" 버튼이 실기기(시뮬레이터 아님)에서 Safari 로 `https://parking-lot-navigator-api.parkingnav.workers.dev/merchant` 를 여는지 확인한다 — Apple 심사가 link-out 흐름을 점검한다.
- 캘린더 탭/위젯 검증: 시뮬레이터 또는 실기기에서 ① 캘린더 dot 표시 ② 필터 시트 적용 시 dot/위젯 동기화 ③ 홈 화면에 Medium 위젯 추가 후 다가오는 축제 3개 카드 노출 ④ 빈 상태(90일 매칭 없음) 문구.

## Apple Developer / Codemagic 사이닝

- 신규 App ID `com.sangminbis9.ParkingLotNavigator.UpcomingFestivalsWidget` 등록 완료. App Groups capability 는 **Configure 버튼으로 `group.com.sangminbis9.ParkingLotNavigator` 매핑까지 완료**해야 한다 (체크박스만 켜는 것은 부족).
- Codemagic 은 **수동 사이닝(Manual)** 방식. 위젯용 distribution provisioning profile (`UpcomingFestivalsWidget` App ID + main app 과 동일한 distribution certificate) 을 새로 발급해 Codemagic Provisioning profiles 슬롯에 업로드한 상태이며, 빌드가 정상 통과함.
- 메인 app / Share Extension / Widget 세 App ID 모두 동일 App Group 에 매핑되어 있어야 한다. 추후 capability 추가/회전 시 세 App ID 모두를 같이 점검.

## 백로그

### 캘린더 / 위젯 v1.1 후보

- EventKit 연동: 축제 상세 → "기본 캘린더에 추가" 버튼. NSCalendarsUsageDescription, PrivacyInfo 갱신 필요.
- Small / Large 위젯 사이즈 추가 (현재 Medium 만 지원).
- Lock Screen / StandBy 위젯.
- 위젯 deep link 진입 (이벤트 상세 직진입).
- 필터 프리셋 저장 / 즐겨찾기 지역 기억.
- 백엔드 `/api/festivals` 에 `from`/`to` 날짜 범위 파라미터 추가 (현재는 90일 윈도우로 충분).

### 알림 v1.1 후보

- 서버 푸시(APNs): Apple Push 키 + Worker 구독 엔드포인트/D1 디바이스 토큰 테이블 + cron 매칭 발송. BGTask best-effort 한계(지연/누락)를 보완해 즉시성 확보.
- 알림 탭 → 해당 축제/이벤트 상세 딥링크 라우팅 (`UNUserNotificationCenterDelegate`).
- 로컬 이벤트 저장(별표) + 마감 임박 리마인더 (현재 로컬 이벤트는 저장 기능 없이 카테고리/지역 기반 발견 알림만).
- 개별 항목 알림(현재는 도메인별 요약 1건)과 알림 그룹/요약 정책 정교화.

### 머천트 퍼널 강화

- 유료 이벤트에 대한 머천트 대시보드 영수증/세금계산서 노출.
- 갱신 흐름: 만료 7일 전 머천트에게 이메일/SMS.
- `paid_until` 환불 또는 연장을 위한 admin override.
- "내 가게 이벤트 수정/취소" 페이지 (현재 폼은 생성 전용).
- Toss `/payment/fail` 의 더 나은 실패 UX (현재는 에러 코드/메시지만 렌더링).

### 로컬 이벤트 발견

- 두-패스 전환(`b511932`) 이후 퍼널 관찰: 17 Naver search + 30 Kakao subrequest (Phase 2 dedup 캐시로 실중복 대폭 감소). `local_events` 일일 delta 를 추적해 꾸준한 후보 증가를 확인.
- Worker 유료 플랜(subrequest 50 → 1000) 업그레이드 시 `LOCAL_EVENT_MAX_KAKAO_LOOKUPS` 를 높여 커버리지 확대 가능.
- 공식 API 가 상세 엔드포인트를 제공하는 곳에서 이벤트 설명에 대한 provider 별 상세 enrichment 추가.
- 추가 발견 소스로 Naver Place feed 조사 (공개 best-effort 만, 헤더 우회나 로그인 쿠키 없음).

### Agent Office

- reject 율이 50% 초과로 유지되면 Workers AI head agent 프롬프트를 튜닝 — 현재는 보수적으로 기운다.
- iOS Office scene 헤더에 `agent_activity` 총계(agent 별 카운터)를 노출해 진행을 한눈에 보이게 한다.
- head agent 가 과도하게 reject 한 항목을 회수하기 위해 admin 에서 수동 `pending → approved` override 노출을 고려한다.

### 기존 플랫폼 백로그

- Worker secret 에 `PUBLIC_DATA_SERVICE_KEY`, `SEOUL_OPEN_DATA_KEY`, `CULTURE_PORTAL_API_KEY`, `KOPIS_API_KEY`, `KCISA_428_API_KEY`, `KCISA_196_API_KEY` 를 설정한 뒤, 발견 admin sync 와 D1 기반 `/discover/*` 엔드포인트를 확인한다.
- provider 가 여전히 행을 반환하지 않으면 정확한 성동 IoT 서울 열린데이터 서비스명/필드 맵을 확보한다.
- 승인이 도착하는 대로 지역 실시간 provider 를 추가한다.
- secret 노출 없이 provider 헬스/디버그 가시성을 개선한다.

### 포트폴리오 영상: 실제 앱 화면 녹화로 교체 (2026-09-09 보류, 일정 미정)

`portfolio-demo/`의 소개 영상(86.5초)에서 앱 화면 S2–S5는 지금 SwiftUI 뷰 구조를 옮긴
구성도다. 작업 환경(WSL)에 macOS/Xcode가 없어 시뮬레이터를 띄울 수 없었기 때문이고,
그래서 각 화면에 `SwiftUI 뷰 구조를 옮긴 구성도 · 실행 화면 캡처 아님` 배지를 달아 두었다.
사용자가 녹화를 나중에 하기로 해서 보류 상태다.

받을 녹화 4개(각 8~10초 넉넉히, 동작은 천천히 한 컷에 하나씩):

| 장면 | 쓰는 길이 | 내용 |
| --- | --- | --- |
| `s2` 지도 | 5.2초 | 핀이 뜬 지도에서 축제/공연/주차 토글을 눌러 핀이 바뀌는 모습 |
| `s3` 상세 | 5.2초 | 행사 상세를 천천히 스크롤 — 기간·장소·요금·프로그램이 지나가게 |
| `s4` 캘린더 | 5.2초 | 날짜를 눌러 아래 목록이 그 날짜로 바뀌는 모습 |
| `s5` 주차 | 5.4초 | 행사 상세에서 주변 주차장으로 넘어가는 모습 |

시뮬레이터는 `xcrun simctl io booted recordVideo --codec h264 <경로>.mov`,
실기기는 제어 센터 화면 기록으로 찍는다. 실기기 쪽이 실제 API에 붙은 데이터가 찍혀 더 낫다.
파일은 WSL에서 읽히는 경로(Windows면 `/mnt/c/...`)에 두면 된다.

붙이는 파이프라인은 만들어 두었고 더미 영상으로 검증했다 —
`portfolio-demo/scripts/import-capture.sh`가 30fps JPEG 시퀀스를 뽑고 폰 프레임 높이를
알려주며, `src/index.html`의 `seek()`가 프레임을 넣고 디코딩까지 기다린다.
상세 절차는 `portfolio-demo/CAPTURE_GUIDE.md`.

교체할 때 **같이** 고쳐야 정직성이 유지된다: 그 장면의 `.badge` 문구를 실제 녹화 표기로 바꾸고,
`ASSETS.md`의 "실제 앱 스크린샷 없음" 항목과 `FACT_CHECK.md` §7의 해당 줄을 갱신한다.
네 장면을 모두 교체하면 배지 자체를 없앤다.

## 새 세션 프롬프트

새 Codex/Claude 세션 시작 시 사용:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md.
Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
