# 다음 단계

마지막 업데이트: 2026-06-11

## 현재 상태

- 브랜치: `master`
- 마지막으로 push 된 커밋: `dd87743 Make crayon theme fully hand-drawn (Gaegu font, rough controls/chips, wax double-stroke cards, crayon hatching)`
- 제품 방향은 축제/이벤트 발견 우선이며, 주차/실시간은 선택한 목적지 방문을 보조하는 역할이다. 여기에 머천트용 유료 로컬 이벤트 등록 퍼널이 더해진다.
- 실시간 주차와 축제/이벤트 레이어는 겹침을 합친(overlap-collapsed) 핀을 사용한다.
- iOS 빌드 번호는 `ios-app/project.yml` 에서 `1.0 (167)` 이다. 크레파스 손그림 전면 강화(폰트 264곳 + 도형 43곳 일괄 전환) 변경분이라 Codemagic 빌드로 컴파일 확인이 필요하다(이 번호의 빌드는 아직 미검증).
- 캘린더 탭(새 6번째 탭) + Medium WidgetKit 위젯(`UpcomingFestivalsWidget`) + 공유 필터(지역/반경/태그/상태)는 v1 로 출시되어 Codemagic 빌드까지 통과한 상태.
- Worker 의 발견·주차 읽기는 D1/사용자 엔드포인트를 사용하며, 외부 provider 호출은 cron/admin sync 로 처리한다.
- CI `deploy-worker` 는 최종 `wrangler deploy` 전에 여러 secret 을 안전하게 stage 하기 위해 `wrangler versions secret put` 을 사용한다.

## 이번 단계 완료 (머천트 + Toss MVP)

머천트/로컬 이벤트 수익화 퍼널의 Phase 1 이 종단 간(end-to-end)으로 안착했다:

| 단계                                                    | 결과    | 커밋      |
| ------------------------------------------------------- | ------- | --------- |
| 머천트 가입 랜딩 + Naver/Kakao OAuth                    | 완료    | `13908cd` |
| Kakao client secret 지원                                | 완료    | `becadbf` |
| 이벤트 등록 폼, R2 이미지 업로드, 시작일                | 완료    | `52a133e` |
| Toss Payments 위젯 통합                                 | 완료    | `5b38483` |
| `/api/local-events` 만료 + pending_payment 필터         | 완료    | `a5edbd8` |
| iOS 설정에서 머천트 웹 흐름으로 link-out                | 완료    | `c31bf14` |
| CI secret 처리 수정 (versions secret put)               | 완료    | `9d8be9d` |

D1 migration `0008_local_event_pending_payment.sql` 은 원격 DB 에 적용되고 커밋되었다.

운영 상태:

- `MERCHANT_IMAGES` R2 버킷 생성·바인딩 완료.
- `MERCHANT_SESSION_SECRET`, `KAKAO_CLIENT_SECRET`, `NAVER_CLIENT_ID/SECRET`, `KAKAO_REST_API_KEY` 가 Worker secret 으로 설정됨.
- `TOSS_CLIENT_KEY` (테스트 위젯 키 `test_gck_docs_...`) 는 `wrangler.toml` 에 있고, `TOSS_SECRET_KEY` (`test_gsk_docs_...`) 는 Worker secret 이다. 둘 다 Toss 머천트 온보딩 후 `live_gck_...` / `live_gsk_...` 로 교체해야 한다.

완료한 검증:

- `pnpm -C worker-backend typecheck` 통과.
- 프로덕션 스모크: `/api/local-events` 는 approved 이고 non-sponsored 인 행만 반환한다. pending_payment 행은 D1 에 존재하며 올바르게 숨겨진다.
- D1 행 수(2026-05-19 스냅샷): approved/non-sponsored 23, pending/non-sponsored 4, pending_payment/sponsored 1.

## 최근 출시 (크레파스 테마 + 머천트 페이지 단장)

- 크레파스(Crayon) 테마 추가(`5da1818`, 빌드 수정 `f47daa3`): 설정 → 테마 6번째 옵션. 손그림 외곽선/오프셋 스티커 그림자/종이 질감, 기존 5개 테마는 코드 경로 불변.
- 크레파스 손그림 전면 강화(`dd87743`): 개구쟁이체(Gaegu, OFL) 번들 + `Font.festival` 토큰으로 앱 전역 264곳 손글씨화, 컨트롤/칩 43곳 손그림 도형(`controlShape`/`chipShape`), 카드 왁스 이중 스트로크, 사선 크레용 해칭, 네비/탭바·지도 마커 라벨까지 적용.
  - 검증 필요: Codemagic 빌드(167) 통과 → 시뮬레이터에서 ① 크레파스 선택 시 손글씨/손그림 전환 ② 허니 등 기존 테마 무회귀 ③ 재시작 후 테마 유지 ④ 긴 리스트 스크롤 성능.
- 머천트 페이지 허니 테마 + 약관 팝업(`f55a2a4`): `/merchant` 전 페이지를 앱 허니 팔레트 CSS 변수로 재스타일, 이용약관/개인정보/환불정책 `<dialog>` 팝업(`/legal/*` 재사용), 등록 폼 필수 동의 체크 + 서버 검증.
  - 검증 필요: Worker deploy(CI `deploy-worker` 성공 여부 확인) 후 `/merchant` 에서 테마/팝업/동의 흐름 확인.

## 이전 출시 (캘린더 개편 + 알림)

- 캘린더 탭 개편(`c587edd`): 하단 인라인 어젠다, 카테고리 색 dot, 스와이프 월 이동, 저장(별표) + 시작 전 로컬 알림 리마인더, "오늘 / 이번 주말" 프리셋.
- 프로젝트 정밀 최적화(`cea4fca`): Worker GET 60s 엣지 캐시 + tags 단일 파싱, iOS 포매터/Calendar hoist, MapHomeView 데드코드 제거.
- 커스터마이즈 알림 설정(`3e64067`): 설정 → "알림" 전용 화면에서 축제/로컬 이벤트를 각각 분리해 발견 알림(카테고리/지역/반경)·리마인더 시점/시각·방해 금지 시간·하루 한도를 설정. `BGAppRefreshTask` 로 백그라운드 신규 발견 → 로컬 알림. APNs 미사용(best-effort).
  - 검증 필요: Codemagic 빌드(164)로 컴파일 확인. 실기기에서 설정 진입·권한 프롬프트·값 영속·`BGTaskScheduler` 시뮬레이션(`_simulateLaunchForTaskWithIdentifier:`) 확인.
  - 60s 엣지 캐시 활성화를 위한 Worker deploy 가 아직 남아 있으면 함께 처리한다(WSL 토큰 만료로 미배포 상태일 수 있음).

## Toss 프로덕션 키 수령 후

차단 외부 항목: 사업자등록증 발급 (진행 중, 2026-05-18 신청). 수령 후:

1. 새 사업자등록으로 Toss Payments 가맹점 가입을 완료한다.
2. **결제위젯 연동 키**를 발급한다 ("API 개별 연동 키"는 **사용하지 않는다**).
3. `worker-backend/wrangler.toml` 의 `TOSS_CLIENT_KEY` 를 `live_gck_...` 로 교체한다.
4. `pnpm -C worker-backend exec wrangler secret put TOSS_SECRET_KEY` 로 `live_gsk_...` 를 설정한다.
5. `pnpm -C worker-backend run deploy`.
6. 개인 카드로 실제 10,000원 테스트 결제를 1회 실행한다. D1 행이 `approved` 로 바뀌고, `paid_until = startDate + 3 months` 이며, `/api/local-events` 가 노출하는지 확인한다.

## iOS 빌드 / 릴리스

- Codemagic/Xcode 빌드는 iOS 파일이 바뀔 때만 필요하다.
- 현재 `CURRENT_PROJECT_VERSION` 은 `167` (`dd87743` 반영). 다음 Codemagic/TestFlight 업로드 시 publish 로그의 `Version code` 가 App Store Connect 의 기존 최고 빌드보다 높은지 확인한다.
- "내 가게 이벤트 등록" 버튼이 실기기(시뮬레이터 아님)에서 Safari 로 `https://parking-lot-navigator-api.parkingnav.workers.dev/merchant` 를 여는지 확인한다 — Apple 심사가 link-out 흐름을 점검한다.
- 캘린더 탭/위젯 검증: 시뮬레이터 또는 실기기에서 ① 캘린더 dot 표시 ② 필터 시트 적용 시 dot/위젯 동기화 ③ 홈 화면에 Medium 위젯 추가 후 다가오는 축제 3개 카드 노출 ④ 빈 상태(90일 매칭 없음) 문구.

## Apple Developer / Codemagic 사이닝 (위젯 추가 후)

- 신규 App ID `com.sangminbis9.ParkingLotNavigator.UpcomingFestivalsWidget` 등록 완료. App Groups capability 는 **Configure 버튼으로 `group.com.sangminbis9.ParkingLotNavigator` 매핑까지 완료**해야 한다 (체크박스만 켜는 것은 부족).
- Codemagic 은 **수동 사이닝(Manual)** 방식. 위젯용 distribution provisioning profile (`UpcomingFestivalsWidget` App ID + main app 과 동일한 distribution certificate) 을 새로 발급해 Codemagic Provisioning profiles 슬롯에 업로드한 상태이며, 빌드가 정상 통과함.
- 메인 app / Share Extension / Widget 세 App ID 모두 동일 App Group 에 매핑되어 있어야 한다. 추후 capability 추가/회전 시 세 App ID 모두를 같이 점검.

## Worker deploy 후

- 미적용 D1 migration 을 적용한다: `0005_local_events_admin.sql`, `0006_local_event_reports.sql`, `0007_merchant_signup.sql`, `0008_local_event_pending_payment.sql`. `apply-d1-migrations.yml` workflow 는 0001–0004 만 나열하므로, 누락분을 추가하거나 `wrangler d1 execute --remote --file <path>` 로 실행한다.
- 실시간/발견 provider 변경에 대해 cron sync 를 실행하거나 대기한다.
- 프로덕션 Worker 에서 `/parking/nearby`, `/parking/realtime`, `/discover/festivals`, `/discover/events`, `/api/local-events`, `/merchant` 를 확인한다.

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

- 예산 재조정 이후 퍼널 관찰: 17 search + 30 Kakao subrequest 의 시간당 cron. `local_events` 일일 delta 를 추적해 꾸준한 후보 증가를 확인.
- `kakao_lookup_budget_exhausted` 가 여전히 호출당 ~80–100 후보를 누수한다. Worker 유료 플랜(subrequest 50 → 1000)이 가장 깔끔한 해법이며, 대안은 각 호출이 더 많은 별개 매장에 도달하도록 키워드/소스를 청크로 나누는 것이다.
- 검색 루프는 결정적(region → keyword → source)이다. 같은 청크가 반복적으로 첫 키워드에서 예산을 소진한다. `chunkIndex` 로 키워드/소스 순서를 회전시켜 커버리지를 고르게 퍼뜨리는 것을 고려한다.
- 공식 API 가 상세 엔드포인트를 제공하는 곳에서 이벤트 설명에 대한 provider 별 상세 enrichment 추가.
- 추가 발견 소스로 Naver Place feed 조사 (공개 best-effort 만, 헤더 우회나 로그인 쿠키 없음).

### Agent Office

- reject 율이 50% 초과로 유지되면 Workers AI head agent 프롬프트를 튜닝 — 현재는 보수적으로 기운다.
- iOS Office scene 헤더에 `agent_activity` 총계(agent 별 카운터)를 노출해 진행을 한눈에 보이게 한다.
- head agent 가 과도하게 reject 한 항목을 회수하기 위해 admin 에서 수동 `pending → approved` override 노출을 고려한다.

### 기존 플랫폼 백로그

- Worker secret 에 `PUBLIC_DATA_SERVICE_KEY`, `SEOUL_OPEN_DATA_KEY`, `CULTURE_PORTAL_API_KEY`, `KOPIS_API_KEY`, `KCISA_428_API_KEY`, `KCISA_196_API_KEY`, `KAKAO_REST_API_KEY` 를 설정한 뒤, 발견 admin sync 와 D1 기반 `/discover/*` 엔드포인트를 확인한다.
- provider 가 여전히 행을 반환하지 않으면 정확한 성동 IoT 서울 열린데이터 서비스명/필드 맵을 확보한다.
- 승인이 도착하는 대로 지역 실시간 provider 를 추가한다.
- secret 노출 없이 provider 헬스/디버그 가시성을 개선한다.
- `apply-d1-migrations.yml` 을 0008 까지 모든 migration 을 포함하도록 갱신한다.

## 새 세션 프롬프트

새 Codex/Claude 세션 시작 시 사용:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md.
Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
