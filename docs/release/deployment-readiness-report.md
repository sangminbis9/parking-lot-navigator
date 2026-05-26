# 이벤트다 배포 준비 점검 보고서

- 작성일: 2026-05-25 (캘린더/위젯 항목 2026-05-26 갱신)
- 작성자: 운영 분석 (Claude)
- 대상 브랜치/커밋: `master` @ c65a3a5
- 대상 범위: iOS 앱 (`ios-app/`), Worker 백엔드 (`worker-backend/`), 머천트/결제 흐름, 운영 문서, 데이터 파이프라인
- 보고서 목적: App Store 출시 직전에 발견되는 P0 차단 요소와, 출시 이후 30~90일 안에 보강해야 할 운영·상업·기술 항목을 분야별로 정리하여 의사결정 자료로 사용

---

## 0. Executive Summary

이벤트다는 데이터 수집 파이프라인(공공 API 활용률 100% 도달), Worker 기반 운영 API, 머천트 결제 흐름(Toss 위젯), iOS SwiftUI 클라이언트가 모두 기본 동작하는 상태입니다. 다만 **Apple 심사 통과**와 **유료 결제 운영**에 필요한 법적·운영적 산출물이 누락되어 있어, 현 시점에 그대로 제출하면 리젝 또는 결제 차단 가능성이 높습니다.

차단 위험이 가장 큰 5개(P0):

1. `PrivacyInfo.xcprivacy` 미존재 — Xcode 16 이후 제출 시 리젝
2. 개인정보처리방침 호스팅 URL 미준비 — App Store Connect 필수 입력
3. 이용약관 / 환불 정책 페이지 없음 — Toss 결제 사용 시 전자상거래법 의무
4. iOS 크래시 트래킹(Sentry/Crashlytics) 미연동 — 라이브 운영 불가 수준
5. App Store 스크린샷 5장 및 Privacy 질문지 답변 미작성 — 제출 자체 차단

P0 해결 후에는 운영 모니터링(Cron 실패 알림, D1 백업), 머천트 KYC·환불 SOP, 사용자 retention 장치(푸시·위젯·온보딩) 순으로 보강하는 것을 권장합니다.

---

## 목차

1. Apple 심사 / 법무 (App Store Compliance)
2. 보안 / 개인정보 운영
3. 머천트 / 결제 / 수익 모델
4. 제품 / UX 완성도
5. 데이터 / 콘텐츠 품질
6. 운영 / 모니터링
7. GTM / 마케팅
8. 품질 / 개발 인프라
9. 상업·제품 확장 아이디어
10. 즉시 차단 P0 5개 정리
11. 권장 로드맵 (T-30 / T-0 / T+30 / T+90)

심각도 표기: 🔴 P0(차단) · 🟡 P1(출시 전 보강) · 🟠 P2(출시 후 30~90일) · 🟢 OK 또는 보류

---

## 1. Apple 심사 / 법무

| 항목                                       | 현재 상태                                          | 우선순위          | 권장 조치                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrivacyInfo.xcprivacy` (Privacy Manifest) | 없음                                               | 🔴 P0             | 2024-05 이후 Apple 필수. 앱·확장(ShareExtension) 각각에 `NSPrivacyTrackingDomains`, `NSPrivacyCollectedDataTypes`, `NSPrivacyAccessedAPITypes`(예: `FileTimestamp`, `UserDefaults`, `SystemBootTime`) 정의 |
| App Store Privacy 질문지 답변              | 미준비                                             | 🔴 P0             | 위치/식별자/구매기록(Toss)/사용 데이터 사용 목적 표 작성. Kakao Login·Naver Login 사용분 명시                                                                                                              |
| 개인정보처리방침 호스팅 URL                | 템플릿만 존재 (`docs/privacy/privacy-template.md`) | 🔴 P0             | 공개 가능한 URL(GitHub Pages 또는 Worker `/legal/privacy`)로 게시 — App Store Connect 입력 필수                                                                                                            |
| 이용약관 / 환불·취소 정책                  | 없음                                               | 🔴 P0 (Toss 사용) | 유료 머천트 결제·환불(전자상거래법) 약관 필요. Worker `/legal/terms`, `/legal/refund-policy` 추가                                                                                                          |
| 위치 권한 문구 (NSLocation\*)              | "주차장 길안내" 1문장만 존재                       | 🟡 P1             | 현 UX(이벤트/축제 주변 추천)에 맞게 갱신                                                                                                                                                                   |
| Kakao Mobility SDK 상용 라이선스           | 체크리스트 미확정                                  | 🟡 P1             | 상용 배포 전 Kakao Mobility 계약 필요. 없으면 길안내 SDK 제거하거나 외부 앱 호출로 대체                                                                                                                    |
| Kakao Maps SDK · 공공데이터 출처 표기      | iOS 내부 미확인                                    | 🟡 P1             | 설정 화면에 "© Kakao Map / Data: 서울 열린데이터광장, 공공데이터포털, KOPIS, TourAPI 등" 출처 노출 (공공데이터 이용약관 의무)                                                                              |
| ITSAppUsesNonExemptEncryption              | `false` 명시됨                                     | 🟢 OK             | 유지                                                                                                                                                                                                       |
| Sign in with Apple                         | 없음                                               | 🟠 P2             | 앱 자체엔 로그인 없음(머천트만 Naver/Kakao on Web). 앱 내 3rd-party 로그인 도입 시 Apple Sign-In 동등 제공 의무                                                                                            |
| ATT (NSUserTracking)                       | 없음                                               | 🟢 OK             | 3rd-party tracking SDK 없으면 불필요                                                                                                                                                                       |

---

## 2. 보안 / 개인정보 운영

| 항목                                          | 현재 상태                                | 우선순위 | 권장 조치                                                                                                                                |
| --------------------------------------------- | ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Worker 시크릿 회전 절차                       | 문서화 부족                              | 🟡 P1    | `KAKAO_REST_API_KEY`, `NAVER_*`, `SEOUL_*`, `MERCHANT_SESSION_SECRET`, `TOSS_SECRET_KEY` 회전 주기/방법 runbook 작성                     |
| Rate limit / abuse 방지                       | Worker에 미적용                          | 🟡 P1    | `/api/*` 에 IP/UA 기반 rate limit (Cloudflare Rate Limiting Rules 또는 Hono 미들웨어). 머천트 OAuth callback, R2 이미지 업로드 폭주 방어 |
| CORS 정책                                     | 점검 필요                                | 🟡 P1    | `origin: true` 면 위험. iOS 앱은 CORS preflight 안 보내지만, 머천트 웹 origin만 허용으로 좁혀야 함                                       |
| `local_events.pending`/`pending_payment` 노출 | 공개 API에서 제외됨                      | 🟢 OK    | 유지                                                                                                                                     |
| Admin 토큰 노출 경로                          | `Authorization: Bearer SYNC_ADMIN_TOKEN` | 🟠 P2    | 평문 토큰 1개라 로테이션 비용 큼. JWT 만료/scoped token 도입 검토                                                                        |
| 머천트 이미지 EXIF/위치 메타                  | 클라이언트 1600px 압축만                 | 🟠 P2    | 업로드 시 EXIF GPS 제거. R2 PUT 직전 sharp/Squoosh로 normalize                                                                           |
| 로그에 PII 유입                               | 정책상 금지하나 자동 차단 없음           | 🟠 P2    | `console.warn` 인자 sanitizer 또는 OpenTelemetry export 필터                                                                             |

---

## 3. 머천트 / 결제 / 수익 모델

| 항목                        | 현재 상태              | 우선순위          | 권장 조치                                                                       |
| --------------------------- | ---------------------- | ----------------- | ------------------------------------------------------------------------------- |
| Toss 라이브 키 전환         | 테스트 키 사용 중      | 🔴 P0 (출시 시점) | `live_gck_*` / `live_gsk_*` 발급(사업자등록 필수). 발급 후 wrangler secret 교체 |
| 사업자등록 / 통신판매업신고 | 미진행                 | 🔴 P0 (수익화 시) | 유료 머천트 광고 게재는 통신판매업 해당 가능성. 법무 검토 후 신고               |
| 세금계산서 / 부가세 처리    | 없음                   | 🟡 P1             | 10,000원 × 3개월 상품 → 부가세 포함 표기, 매출 집계 보고 흐름 정의              |
| 머천트 환불 흐름            | 없음                   | 🟡 P1             | Toss `cancel` API + `local_events.status='refunded'` 추가, 관리자 화면에서 처리 |
| 머천트 약관 동의 체크박스   | 미확인                 | 🟡 P1             | 결제 직전 약관/환불정책/3자 정보제공 동의 명시적 체크 (전상법)                  |
| 머천트 KYC                  | 없음                   | 🟠 P2             | 사기/대리등록 방지 위해 사업자번호 검증 (국세청 사업자상태 조회 API)            |
| 앱 내 결제 유도 텍스트      | Settings → Safari 링크 | 🟢 OK             | Apple 3.1.3(b) B2B carve-out 유지. "앱 내에서 구매" 표현 금지 — 카피 검수 필요  |
| 가격 정책 A/B               | 10,000원 / 3개월 고정  | 🟠 P2             | 카테고리·지역별 가격 차등 가능하도록 `event_prices` 테이블 도입 검토            |

---

## 4. 제품 / UX 완성도

| 항목                              | 현재 상태                                          | 우선순위 | 권장 조치                                                                                            |
| --------------------------------- | -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| 온보딩 첫 화면                    | 미확인(스플래시만)                                 | 🟡 P1    | "이벤트다가 뭘 보여주는 앱인지" 3-step 가벼운 온보딩 → 위치권한 요청 타이밍 분리                     |
| 빈 상태(empty state) 카피         | 마스코트는 있음                                    | 🟡 P1    | "근처 이벤트가 없을 때 / 위치 권한 거부 시 / 네트워크 오류" 케이스별 일러스트+CTA                    |
| 오프라인 / 약전계 동작            | 미확인                                             | 🟡 P1    | 마지막 응답 캐시 후 "오프라인 보기" 배너 표시. 현재 캐시는 서버단(6h)뿐                              |
| 푸시 알림                         | 미설정                                             | 🟠 P2    | "근처 신규 축제" 알림(opt-in)이 retention 핵심. APNs + Worker scheduled push                         |
| 즐겨찾기/북마크 동기화            | iCloud 미사용 추정                                 | 🟠 P2    | CloudKit 또는 서버 동기화로 기기변경 대응                                                            |
| 위젯 / Live Activity              | Medium `UpcomingFestivalsWidget` 출시 (2026-05-26) | 🟢 v1    | 다가오는 축제 3개 카드. Small/Large/Lock Screen/StandBy 위젯은 v1.1 후보                             |
| 다국어                            | 한국어 only                                        | 🟢 보류  | KR 한정이면 OK. 영어 추가 시 외국인 관광객 시장 확장 가능                                            |
| 다크모드                          | 미확인                                             | 🟡 P1    | 마스코트/팔레트가 따뜻한 톤 — 다크에서 가독성 회귀 테스트 필요                                       |
| 접근성 (Dynamic Type / VoiceOver) | 점검 부족                                          | 🟡 P1    | 카드/필터 칩 Accessibility label, Dynamic Type Large까지 레이아웃 검증 (Apple 심사 reject 사유 빈번) |
| 공유 확장 → 목적지 변환           | 구현됨                                             | 🟢 OK    | 카카오맵/네이버지도/카카오톡 공유 텍스트 케이스별 테스트                                             |
| AgentOffice (LLM head review) UI  | 구현됨                                             | 🟠 P2    | 사용자에게 "AI가 자동 검수합니다" 고지(생성형 AI 사용 표기) — Apple 4.0 가이드라인                   |

---

## 5. 데이터 / 콘텐츠 품질

| 항목                       | 현재 상태                       | 우선순위 | 권장 조치                                                                                                      |
| -------------------------- | ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| API 활용률                 | 6+4 fix 후 100% pagination 도달 | 🟢 OK    | 100% 활용 직후 cron 부담 / Worker 서브리퀘스트 한도 회귀 모니터 필요                                           |
| 데이터 출처 표기           | 미흡                            | 🟡 P1    | 공공데이터포털 / 서울 열린데이터광장 / KOPIS / TourAPI 출처 명시(법적 의무)                                    |
| 이벤트 사진 저작권         | 외부 URL 참조                   | 🟠 P2    | hotlink 끊김 대비 R2 캐싱 + 출처 표기. 공식 출처 외 이미지 사용 시 라이선스 검토                               |
| 축제 종료/이전 데이터 정리 | `endDate < today` 필터          | 🟢 OK    | 정상                                                                                                           |
| 로컬 이벤트 신뢰도         | 자동승인 점수 0.75              | 🟡 P1    | 사용자 신고 채널(`POST /api/local-events/report`)이 있긴 함 → 신고 누적 시 자동 강등 룰 추가                   |
| 데이터 중복/충돌           | provider 간 dedupe 미확인       | 🟠 P2    | TourAPI 키워드/Area 두 source가 동일 contentId 다른 prefix로 중복 노출 가능성 — cross-provider dedupe key 정의 |

---

## 6. 운영 / 모니터링

| 항목                     | 현재 상태                      | 우선순위 | 권장 조치                                                                        |
| ------------------------ | ------------------------------ | -------- | -------------------------------------------------------------------------------- |
| 에러 트래킹 (iOS)        | 없음                           | 🔴 P0    | Sentry/Crashlytics 미연결. 라이브 출시 후 크래시 원인 추적 불가                  |
| Worker 로그 집계         | `console.warn` only            | 🟡 P1    | Cloudflare Logpush → R2/Datadog 또는 Workers Logs 활성화                         |
| Provider Health 대시보드 | `/providers/health` endpoint만 | 🟡 P1    | Grafana/Workers Analytics Engine 도입 → 시각 대시보드                            |
| Cron 실패 알림           | 없음                           | 🔴 P0    | 5분 realtime cron, hourly sync, local event sync 실패 → Discord/Slack/Email 알림 |
| D1 백업                  | 자동 백업 없음                 | 🟡 P1    | `wrangler d1 export` 일일 R2 백업 cron 추가                                      |
| 사용자 피드백 채널       | 없음                           | 🟡 P1    | Settings에 "문의하기" → 이메일 또는 Tally/Forms                                  |
| 앱 버전 강제 업데이트    | 없음                           | 🟠 P2    | `/api/config` 로 minimum supported version 내려보내고 앱에서 강제 업데이트 모달  |

---

## 7. GTM / 마케팅

| 항목                                | 현재 상태                                | 우선순위 | 권장 조치                                                                                     |
| ----------------------------------- | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| 앱 스토어 스크린샷 (6.7"/6.5"/5.5") | 없음                                     | 🔴 P0    | 5장 이상 + 첫 2장이 결정적 (지도 + 이벤트 상세 + 머천트 등록)                                 |
| 앱 미리보기 동영상                  | 없음                                     | 🟠 P2    | 15-30초 데모 — CTR 큰 차이                                                                    |
| 앱 이름 / 부제 / 검색 키워드 ASO    | 미확정                                   | 🟡 P1    | "이벤트다" 브랜드 + "축제 / 동네 이벤트 / 근처 주차" 키워드 100자 활용                        |
| 랜딩 페이지                         | 없음                                     | 🟡 P1    | `eventda.app` 또는 Worker `/` 에 소개 + 다운로드 링크 + 머천트 진입 분리                      |
| 머천트 영업 자료                    | 없음                                     | 🟡 P1    | "월 3,333원에 동네 손님 노출" 한 장짜리 PDF/landing                                           |
| 분석(Analytics)                     | 없음                                     | 🟡 P1    | PostHog / Amplitude / Firebase Analytics 중 하나. 단, iOS Privacy Manifest 호환 SDK 버전 필수 |
| Universal Links                     | URL Scheme `parkingnavigator://` 만 존재 | 🟠 P2    | Associated Domains + apple-app-site-association → 공유/SNS 링크 진입성 향상                   |
| 출시 사후 review 응대 SOP           | 없음                                     | 🟠 P2    | App Store Connect 리뷰 응답 템플릿(한/영) 준비                                                |

---

## 8. 품질 / 개발 인프라

| 항목                          | 현재 상태                                                                  | 우선순위 | 권장 조치                                                                          |
| ----------------------------- | -------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| iOS 단위 테스트               | `Tests/ParkingLotNavigatorTests.swift` 1개 추정                            | 🟡 P1    | ViewModel·APIClient·DeepLinkRouter 최소 테스트 추가. UI 자동화는 EarlGrey/Sauce 등 |
| backend test coverage         | 43개 통과                                                                  | 🟢 OK    | 유지                                                                               |
| pre-existing tsc 에러         | `tests/seoulProviderPagination.test.ts`, `tests/workerLocalEvents.test.ts` | 🟡 P1    | 알려진 부채 정리 — 무시 누적 시 회귀 감지력 떨어짐                                 |
| CI 게이트                     | Codemagic 빌드 + GitHub Actions 추정                                       | 🟡 P1    | PR 시 `pnpm typecheck && test && preflight` + Worker dry-run 강제                  |
| Codemagic 빌드 번호 자동 증가 | 수동 (`CURRENT_PROJECT_VERSION` 134)                                       | 🟠 P2    | `CI_BUILD_NUMBER` 또는 codemagic.yaml `agvtool` 자동                               |
| Worker 환경 분리              | prod 단일                                                                  | 🟠 P2    | staging Worker + staging D1 분리. 머천트 결제·LLM head agent 회귀 테스트용         |
| 의존성 보안 점검              | 없음                                                                       | 🟠 P2    | Dependabot/Renovate, `pnpm audit` CI 게이트                                        |
| Feature Flag                  | 없음                                                                       | 🟠 P2    | "이벤트 100% 모드", "AgentOffice 노출" 등 토글. 단순 KV 1개로도 충분               |

---

## 9. 상업·제품 확장 아이디어

| 아이디어                                   | 근거                                                        | 난이도  |
| ------------------------------------------ | ----------------------------------------------------------- | ------- |
| "오늘 근처 축제 + 주차 + 길안내" 푸시 알림 | 위치+이벤트+주차 데이터 다 있음. retention KPI 직결         | 🟡 중   |
| 머천트 셀프 대시보드                       | 현재는 결제+등록만. 노출수/클릭수 보여주면 재구매 동기      | 🟡 중   |
| Lock Screen / StandBy 위젯 확장            | Medium Home Screen 위젯 v1 출시 완료. 동일 캐시·필터 재사용 | 🟢 하   |
| 공유 확장 → "주차 추천" 1-tap              | 카카오톡 약속장소 공유 시 즉시 주차 추천                    | 🟢 하   |
| 축제 큐레이션 뉴스레터(주 1회)             | 콘텐츠 자동 생성 + email opt-in으로 머천트 유입 증대        | 🟡 중   |
| 친구와 약속 장소 협의 모드                 | 두 사람 좌표 중간점 + 이벤트 + 주차                         | 🟠 중상 |
| B2B: 지자체 축제 페이지 위젯               | TourAPI 이미 사용, embed iframe 제공 — 지자체 광고비        | 🟠 중상 |
| 유료 머천트 "Highlight" 슬롯               | 단순 게재 외 상단/홈 노출 슬롯 가격 차등                    | 🟢 하   |
| AI 동행 추천 (Workers AI 이미 있음)        | "비 오는 토요일 강남 가족 나들이" 자연어 질의 → orion 활용  | 🟡 중   |

---

## 10. 즉시 차단 P0 5개 정리

| #   | 항목                                         | 차단 사유                   | 1차 산출물                                                |
| --- | -------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| 1   | `PrivacyInfo.xcprivacy`                      | Xcode 16+ 제출 시 자동 리젝 | `ios-app/Resources/PrivacyInfo.xcprivacy` 신규 추가       |
| 2   | 개인정보처리방침 호스팅 URL                  | App Store Connect 필수 입력 | Worker `/legal/privacy` 라우트 또는 `eventda.app/privacy` |
| 3   | 이용약관 + 환불·취소 정책                    | 전자상거래법 (Toss 결제)    | Worker `/legal/terms`, `/legal/refund-policy`             |
| 4   | iOS 크래시 트래킹 (Sentry/Crashlytics)       | 라이브 운영 불가            | Sentry SPM 추가, Privacy Manifest 호환 버전               |
| 5   | App Store 스크린샷 5장 + Privacy 질문지 답변 | 제출 자체 차단              | 6.7"/6.5"/5.5" 스크린샷 + Privacy questionnaire 초안      |

---

## 11. 권장 로드맵

T-30 ~ T-14 (출시 전 점검)

- P0 5개 산출물 작성
- 개인정보처리방침/이용약관/환불정책 호스팅
- Privacy Manifest 적용 후 TestFlight 내부 테스트
- Toss 라이브 키 발급 신청
- Worker Cron 실패 알림(Discord webhook 등) 연동

T-14 ~ T-0 (제출 직전)

- App Store 스크린샷·소개 문구 확정
- 위치 권한 문구 갱신, 출처 표기 화면 추가
- Sentry/Crashlytics 라이브 데이터 흐름 확인
- Rate limit / CORS 좁히기

T+0 ~ T+30 (라이브 운영)

- 사용자 피드백 채널 노출 (Settings → 문의하기)
- D1 일일 백업 cron, Logpush 구성
- 머천트 환불 SOP 및 약관 동의 체크박스
- 분석(Analytics) SDK 도입 후 KPI 정의

T+30 ~ T+90 (확장)

- 푸시 알림 / Lock Screen Widget
- 머천트 셀프 대시보드
- staging Worker + 머천트 KYC
- B2B 위젯 / 지자체 영업

---

부록 — 본 보고서는 read-only 분석으로 작성되었으며, 본문 어떤 항목도 코드 변경을 동반하지 않았습니다. 각 항목의 산출물·구현은 별도 작업 티켓으로 분리하여 처리하는 것을 권장합니다.
