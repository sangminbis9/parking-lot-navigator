# 다음 단계

마지막 업데이트: 2026-06-24

## 현재 상태

- 브랜치: `master`
- 마지막으로 push 된 커밋: `f3e1e22 Bump build number to 174`
- 제품 방향은 축제/이벤트 발견 우선이며, 주차/실시간은 선택한 목적지 방문을 보조하는 역할이다. 여기에 머천트용 유료 로컬 이벤트 등록 퍼널이 더해진다.
- iOS 빌드 번호는 `ios-app/project.yml` 에서 `1.0 (174)`. Codemagic 빌드 후 TestFlight 제출 대기 중.
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
- 현재 `CURRENT_PROJECT_VERSION` 은 `174`. 다음 Codemagic/TestFlight 업로드 시 publish 로그의 `Version code` 가 App Store Connect 의 기존 최고 빌드보다 높은지 확인한다.
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

## 새 세션 프롬프트

새 Codex/Claude 세션 시작 시 사용:

```text
Read docs/PROJECT_STATE.md, docs/DECISIONS.md, docs/NEXT_STEPS.md, and docs/API_RUNBOOK.md.
Continue from the current repo state. Do not repeat or store real API keys/tokens.
```
