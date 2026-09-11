# 이벤트다 배포 준비 점검 보고서

- 작성일: 2026-05-25 (최초) · 2026-05-31 · 2026-07-25 · 2026-09-11 readiness-review 재검사 갱신 · 2026-09-11 TestFlight 검증 반영
- 작성자: 운영 분석 (Claude)
- 대상 브랜치/커밋: `master` @ 67ac768 (iOS 빌드번호 296, TestFlight 업로드·실행 확인 완료)
- 대상 범위: iOS 앱 (`ios-app/`), Worker 백엔드 (`worker-backend/`), 머천트/결제 흐름, 운영 문서, 데이터 파이프라인
- 보고서 목적: App Store 출시 직전에 발견되는 P0 차단 요소와, 출시 이후 30~90일 안에 보강해야 할 운영·상업·기술 항목을 분야별로 정리하여 의사결정 자료로 사용

---

## 0. Executive Summary

이벤트다는 데이터 수집 파이프라인(공공 API 활용률 100% 도달), Worker 기반 운영 API, 머천트 결제 흐름(Toss 위젯), iOS SwiftUI 클라이언트가 모두 기본 동작하는 상태입니다. 2026-09-11 재검사 기준으로 **기술적 출시 차단 요소는 해소**되었고, build 296이 실제로 컴파일되어 **TestFlight 업로드·실행까지 확인**되었습니다. 스크린샷도 2026-09-11에 확보되어(`docs/release/screenshots/`, 6.9" 5장) **남은 제출 차단 요소는 앱 소개 문구 하나뿐입니다.** Toss 라이브 키·사업자등록은 결제를 켜는 시점의 차단 요소이고, 결제를 끈 채 제출하면 이번 심사와 무관합니다.

2026-09-11 재검사에서 확인된 상태(모두 코드/설정/실행 근거 기준):

1. ✅ 해결 — `PrivacyInfo.xcprivacy` 존재 + 1st-party 정합성 유지. App Privacy 답변 문서는 248줄로 확장되어 검색 기록 서버 수집 제거(`99f2fc2`)까지 반영됨
2. ✅ 해결 — 법무 페이지 3종이 production에 배포되어 응답함(`/legal/privacy`·`/legal/terms`·`/legal/refund-policy` 모두 HTTP 200, 2026-09-11 확인). **ASC App Privacy 입력도 완료**(2026-09-11, 사용자 확인). 남은 일은 사업자등록 후 보호책임자란 갱신뿐
3. 🟡 하향 조정 — iOS 외부 Crash SDK(Sentry/Crashlytics)는 **이번 출시 범위에서 도입하지 않기로 결정**(사용자 지시). 대신 조용히 삼켜지던 실패 경로 4곳에 `AppLogger` 로깅을 넣고 `try!`·위험한 force unwrap이 없음을 확인했다. 출시 후 조기 도입 항목으로 남긴다
4. ✅ 해결 — Worker Cron 실패 알림(`notifyOpsFailure`) 코드가 production에 배포됨. Workers 관측(`observability.enabled = true`, `head_sampling_rate = 1`)도 켜져 있다. `OPS_ALERT_WEBHOOK_URL` secret 설정 여부는 코드로 확인 불가 — 사용자 확인 필요
5. 🟢 해결 — App Store 스크린샷 5장 확보(`docs/release/screenshots/`, 1320×2868 sRGB, CI 캡처 run `34614345570`). 남은 제출 산출물은 앱 소개 문구뿐
6. ✅ 해결 — build 296 컴파일 성공, TestFlight 업로드·실행 확인(2026-09-11, 사용자). 이전 회차에서 "WSL2 환경이라 iOS 빌드 검증 불가"로 열려 있던 항목이 닫혔다. 다만 TestFlight 실행 확인은 앱이 뜬다는 것이지 접근성·다크모드·권한 거부 흐름을 개별 검증했다는 뜻은 아니다

이번 재검사에서 새로 🟢로 넘어간 것들: 서버 APNs 푸시(`notification_digests` 기반) 구현·운영, 다크모드 구현(`AppRootView.swift:119`), 익명 사용 집계(`analytics_daily`, migration `0030`), Settings 문의하기 채널, CI 게이트(`deploy-worker.yml`이 typecheck → worker test → backend test → migration → deploy → smoke 순으로 체인), Worker/D1 무료 한도 대응(조건부 쓰기·인덱스 정리).

이번 작업으로 새로 고친 UX: 첫 실행 즉시 뜨던 위치 권한 팝업을 사용자 액션 뒤로 미뤘고, 위치가 없을 때 서울시청으로 고정되던 기본 좌표를 `FallbackLocation`(마지막 위치 → 저장 지역 → 서울)으로 바꿨으며, 네트워크 실패를 연결 실패·응답 지연·서버 오류·데이터 없음으로 구분해 재시도 버튼과 함께 보여준다.

남은 실질 차단 요소는 **앱 소개 문구(🔴)** 하나이고, 그 밖에 **Toss 라이브 키/사업자등록(🔴, 수익화 시점 한정)**, 데이터 품질 쪽의 **로컬 매장 이벤트 밀도 부족(🟡)**, **앱 내 데이터 출처 표기 부재(🟡)**가 남아 있습니다. D1 일일 행 쓰기 24시간 실측은 아직 `실측 필요` 상태입니다(`docs/operations/worker-limits.md`).

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
10. 즉시 차단 P0 정리
11. 권장 로드맵 (제출 직전 / 출시 직후 30일 / 30~90일)

심각도 표기: 🔴 P0(차단) · 🟡 P1(출시 전 보강) · 🟠 P2(출시 후 30~90일) · 🟢 OK 또는 보류

## 변경 로그

- 2026-09-11 (@8054ae5, 스크린샷 확보): 해결 1건(App Store 스크린샷 5장 — CI 시뮬레이터 캡처 파이프라인 신설 후 `docs/release/screenshots/`에 커밋). P0 표 5번 행이 닫히고 남은 차단 요소는 앱 소개 문구 1건이다.
- 2026-09-11 (@67ac768, TestFlight 검증 반영): 해결 2건(iOS build 296 컴파일 + TestFlight 업로드·실행 확인 — 이전 회차의 "WSL2라 빌드 검증 불가" 항목이 닫힘, ASC App Privacy 입력 완료). P0 표에서 2·3번 행이 닫히고 실제 차단 요소가 스크린샷 1건으로 줄었다. 출처: 사용자 보고(저장소로는 확인 불가한 항목).
- 2026-09-11 (@99f2fc2 + 미커밋분): 해결 9건(법무 페이지 production 배포 확인, 서버 APNs 푸시, 다크모드, 익명 분석, 사용자 피드백 채널, CI 게이트, Workers 관측 활성화, 위치 권한 요청 타이밍, 네트워크 오류 구분 UX), 상태변경 6건(iOS Crash SDK 🔴→🟡 사용자 결정으로 이번 출시 범위 제외, CORS admin 경로 제외로 부분 개선, App Privacy 답변 122→248줄, iOS 테스트 1→3파일, accessibilityLabel 4/67→12/100 파일, 빌드번호 189→296), 정정 3건(데이터 출처 표기가 실제로는 앱에 없음 — 기존 "표기 존재" 서술이 사실과 달랐음, backend pre-existing tsc 에러가 2건이 아니라 연쇄 에러 포함 다수, CI가 "tsc만 통과하면 배포"라는 서술이 더 이상 사실 아님), 신규 5건(행사 콘텐츠 밀도 진단 결과, 로컬 매장 이벤트 밀도 부족, 위치 권한 거부 기본 상태, 레거시 명칭 rename 부채, 로컬 저장 기능 클라우드 동기화 보류 결정). 검증: worker-backend typecheck 통과, worker-backend 테스트 310개 통과, backend 테스트 73개 통과.
- 2026-07-25 (@5a73b9f): 해결 2건(축제 cross-provider dedup을 title+haversine 거리+날짜range 겹침 기준으로 정교화, 머천트 결제 폼 필수 약관동의 체크박스), 상태 갱신 2건(로컬 발견 알림 시스템이 카테고리/지역/반경 커스터마이즈까지 구현됨을 반영 — 서버 APNs는 여전히 백로그, 즐겨찾기 기능 존재는 확인했으나 iCloud 동기화는 없음 재확인), 재확인 후 변화 없음(iOS 크래시 트래킹·CORS 미제한·rate limit 없음·Kakao Mobility SDK 미연동·온보딩 없음·다크모드 미대응·접근성 라벨 4/67 파일·D1 자동백업 없음·backend pre-existing tsc 에러 2건 그대로·Toss 테스트 키·사업자등록 대기). iOS 빌드번호 161→189, backend 테스트 43→44개 통과, worker typecheck 통과 재확인.
- 2026-05-31 (@b76c8a7): 해결 3건(PrivacyInfo.xcprivacy 존재, 위치권한 문구 갱신, legal 페이지 콘텐츠 구현), 부분해결 3건(개인정보처리방침·약관·환불 라우트 코드 완료=배포/ASC 입력만 남음, 데이터 출처 표기 일부), 상태변경 1건(iOS 빌드번호 134→160), 신규 1건(PrivacyInfo가 CrashData 수집을 선언했으나 크래시 SDK 미연동 — 정합성 필요). worker typecheck 통과 확인.
- 2026-05-31 (P0 조치): Cron 실패 알림 코드 구현(`worker-backend/src/index.ts` `notifyOpsFailure` + 6개 cron catch, Discord/Slack webhook). PrivacyInfo 1st-party 정합성 정리(CrashData/Performance 선언 제거). iOS 빌드번호 160→161. Privacy 질문지 초안이 이미 존재함을 확인(stale 수정). worker typecheck 통과. ⚠️ Worker 배포는 비대화형 환경 인증 토큰 부재로 미실행 — 사용자 실행 필요.

---

## 1. Apple 심사 / 법무

| 항목                                       | 현재 상태                                          | 우선순위          | 권장 조치                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrivacyInfo.xcprivacy` (Privacy Manifest) | 있음 + 1st-party 정합성 정리 완료 | 🟢 OK | 해결됨 — PreciseLocation만 1st-party 선언, 크래시 SDK 미연동에 맞춰 CrashData/Performance 선언 제거(2026-05-31). 추후 Sentry 도입 시 CrashData 재선언 필요 |
| App Store Privacy 질문지 답변 | 문서 존재 (`docs/release/app-store-privacy-answers.md`, 248줄, 2026-09-11 확인) | 🟡 P1 | 항목별 답변이 코드 근거와 함께 정리됨. 검색 기록 서버 수집 제거(`99f2fc2`)와 APNs 토큰 수집이 반영되어 있음. 남은 일: ASC에 실제 입력(사용자) |
| 개인정보처리방침 호스팅 URL | production 배포됨 — `GET /legal/privacy` HTTP 200 (2026-09-11 확인) | 🟡 P1 | 호스팅 완료. 남은 일: 공개 URL을 App Store Connect에 입력(사용자). 보호책임자란은 사업자등록 후 갱신 |
| 이용약관 / 환불·취소 정책 | production 배포됨 — `/legal/terms`·`/legal/refund-policy` 모두 HTTP 200 (2026-09-11 확인) | 🟡 P1 | 앱 Settings는 개인정보 처리방침·이용약관만 링크한다(`SettingsView.swift:193-194`). **환불·취소 정책 링크는 앱에 없음** — 머천트 결제 폼에만 있다. 유료 상품을 앱 쪽에서 안내한다면 Settings에도 추가 필요 |
| 위치 권한 문구 (NSLocation\*) | 이벤트·축제·주차 추천 UX에 맞게 갱신됨 | 🟢 OK | 해결됨 (AppInfo.plist NSLocationWhenInUseUsageDescription) |
| Kakao Mobility SDK 상용 라이선스           | 체크리스트 미확정                                  | 🟡 P1             | 상용 배포 전 Kakao Mobility 계약 필요. 없으면 길안내 SDK 제거하거나 외부 앱 호출로 대체                                                                                                                    |
| Kakao Maps SDK · 공공데이터 출처 표기 | **없음** — 2026-09-11 재확인 시 `ios-app` 전체 Swift 코드에 출처 문자열(`data.go.kr`·`열린데이터`·`KOPIS`·`한국관광공사`)이 하나도 없다. 이전 보고서의 "Settings에 표기 존재" 서술은 사실과 달랐다 | 🟡 P1 | Settings에 데이터 출처 화면을 추가한다: data.go.kr(문화체육관광부·한국관광공사 TourAPI), KOPIS, 서울 열린데이터광장, Kakao Local/Kakao Map("© Kakao"), Naver 검색 API. 공공데이터 이용약관상 출처 표시 의무가 있고, 지도 SDK 저작권 표기 누락은 심사 지적 사유가 된다 |
| ITSAppUsesNonExemptEncryption              | `false` 명시됨                                     | 🟢 OK             | 유지                                                                                                                                                                                                       |
| Sign in with Apple                         | 없음                                               | 🟠 P2             | 앱 자체엔 로그인 없음(머천트만 Naver/Kakao on Web). 앱 내 3rd-party 로그인 도입 시 Apple Sign-In 동등 제공 의무                                                                                            |
| ATT (NSUserTracking)                       | 없음                                               | 🟢 OK             | 3rd-party tracking SDK 없으면 불필요                                                                                                                                                                       |

---

## 2. 보안 / 개인정보 운영

| 항목                                          | 현재 상태                                | 우선순위 | 권장 조치                                                                                                                                |
| --------------------------------------------- | ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Worker 시크릿 회전 절차                       | 문서화 부족                              | 🟡 P1    | `KAKAO_REST_API_KEY`, `NAVER_*`, `SEOUL_*`, `MERCHANT_SESSION_SECRET`, `TOSS_SECRET_KEY` 회전 주기/방법 runbook 작성                     |
| Rate limit / abuse 방지                       | Worker에 미적용 (2026-09-11 재확인 — `worker-backend/src`에 `rateLimit` 구현 없음) | 🟡 P1    | `/api/*` 에 IP/UA 기반 rate limit (Cloudflare Rate Limiting Rules 또는 Hono 미들웨어). 머천트 OAuth callback, R2 이미지 업로드 폭주 방어 |
| CORS 정책                                     | 부분 개선 — `/admin`·`/api/admin` 경로는 CORS 헤더를 주지 않도록 제외됨(`index.ts:350`). 공개 `/api/*`는 여전히 기본 `cors()`(모든 origin 허용) | 🟡 P1    | 관리 경로 노출은 닫혔다. 공개 API도 머천트 웹 origin + 앱(Origin 헤더 없음)만 허용하도록 좁히는 것을 권장. 앱은 CORS preflight를 보내지 않으므로 회귀 위험은 낮다 |
| `local_events.pending`/`pending_payment` 노출 | 공개 API에서 제외됨                      | 🟢 OK    | 유지                                                                                                                                     |
| Admin 토큰 노출 경로                          | `Authorization: Bearer SYNC_ADMIN_TOKEN` | 🟠 P2    | 평문 토큰 1개라 로테이션 비용 큼. JWT 만료/scoped token 도입 검토                                                                        |
| 머천트 이미지 EXIF/위치 메타                  | 클라이언트 1600px 압축만                 | 🟠 P2    | 업로드 시 EXIF GPS 제거. R2 PUT 직전 sharp/Squoosh로 normalize                                                                           |
| 로그에 PII 유입                               | 정책상 금지하나 자동 차단 없음           | 🟠 P2    | `console.warn` 인자 sanitizer 또는 OpenTelemetry export 필터                                                                             |

---

## 3. 머천트 / 결제 / 수익 모델

| 항목                        | 현재 상태              | 우선순위          | 권장 조치                                                                       |
| --------------------------- | ---------------------- | ----------------- | ------------------------------------------------------------------------------- |
| Toss 라이브 키 전환         | 테스트 키 사용 중 — `wrangler.toml:60` `TOSS_CLIENT_KEY = "test_gck_docs_..."` (2026-09-11 재확인) | 🔴 P0 (수익화 시점) | `live_gck_*` / `live_gsk_*` 발급(사업자등록 필수). 발급 후 wrangler secret 교체 |
| 사업자등록 / 통신판매업신고 | 미진행                 | 🔴 P0 (수익화 시) | 유료 머천트 광고 게재는 통신판매업 해당 가능성. 법무 검토 후 신고               |
| 세금계산서 / 부가세 처리    | 없음                   | 🟡 P1             | 10,000원 × 3개월 상품 → 부가세 포함 표기, 매출 집계 보고 흐름 정의              |
| 머천트 환불 흐름            | 없음                   | 🟡 P1             | Toss `cancel` API + `local_events.status='refunded'` 추가, 관리자 화면에서 처리 |
| 머천트 약관 동의 체크박스   | 구현됨                 | 🟢 OK             | 해결됨(2026-07-25) — 이벤트 등록 결제 폼에 필수 체크박스, 이용약관·개인정보처리방침·환불정책 링크 포함, 미체크 시 서버에서 거부(`worker-backend/src/merchant/pages.ts:333-339`, `routes.ts:322`) |
| 머천트 KYC                  | 없음                   | 🟠 P2             | 사기/대리등록 방지 위해 사업자번호 검증 (국세청 사업자상태 조회 API)            |
| 앱 내 결제 유도 텍스트      | Settings → Safari 링크 | 🟢 OK             | Apple 3.1.3(b) B2B carve-out 유지. "앱 내에서 구매" 표현 금지 — 카피 검수 필요  |
| 가격 정책 A/B               | 10,000원 / 3개월 고정  | 🟠 P2             | 카테고리·지역별 가격 차등 가능하도록 `event_prices` 테이블 도입 검토            |

---

## 4. 제품 / UX 완성도

| 항목                              | 현재 상태                                          | 우선순위 | 권장 조치                                                                                            |
| --------------------------------- | -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| 온보딩 첫 화면                    | 없음 — `ios-app`에 온보딩 화면 파일이 존재하지 않음(2026-09-11 재확인) | 🟡 P1    | 위치권한 요청 타이밍 분리는 **이번에 별도로 해결**(아래 행 참고)했으므로 온보딩은 순수 설명 목적만 남는다. 3-step 가벼운 온보딩은 출시 후로 미뤄도 차단 요소는 아니다 |
| 위치 권한 요청 타이밍             | 해결됨(2026-09-11) — 첫 실행 즉시 시스템 팝업이 뜨던 구조를 걷어냈다. `CurrentLocationProvider`가 `request()`(명시적 액션에서만 프롬프트)와 `startIfAuthorized()`(절대 프롬프트 없음)로 갈라져 있고, `SearchView`의 `UserLocationProvider`도 init에서 더 이상 요청하지 않는다 | 🟢 OK    | 권한을 거부해도 앱이 막히지 않는다 — 지도·검색·캘린더 모두 `FallbackLocation`으로 동작한다 |
| 위치 권한 거부/미설정 기본 상태   | 해결됨(2026-09-11) — 서울시청 하드코딩을 `FallbackLocation.resolve()`(마지막 위치 → 저장된 지역 필터 centroid → 서울)로 교체. 지도·검색·캘린더 세 경로 모두 적용 | 🟢 OK    | 전국 서비스인데 항상 서울로 시작하던 오해 소지를 제거했다. 지역 직접 선택 유도 배너("위치 켜기")는 `.notDetermined`일 때만 노출한다 |
| 빈 상태(empty state) 카피         | 개선됨(2026-09-11) — 네트워크 실패를 연결 실패 / 응답 지연 / 서버 오류 / 데이터 없음으로 구분해 문구를 만드는 `NetworkErrorMessage`를 추가하고 지도·검색·캘린더·공연·로컬이벤트 화면에 연결. 재시도 버튼 제공 | 🟢 OK    | 케이스별 일러스트는 아직 없다(문구+CTA만). 마스코트 일러스트 추가는 출시 후 항목 |
| 오프라인 / 약전계 동작            | 부분 개선 — 오프라인·타임아웃이 generic 오류가 아니라 원인별 문구 + 재시도로 나온다. 다만 **응답 캐시는 없다**(서버단 캐시만) | 🟠 P2    | 사용자 지시로 이번 출시에서는 오프라인 캐시 시스템을 새로 만들지 않는다. 출시 후 마지막 응답 캐시 + "오프라인 보기" 배너 검토 |
| 푸시 알림                         | 서버 APNs 구현·운영 중(2026-09-11 확인) — Worker cron이 D1(`notification_digests`, migration `0029`)을 읽어 D-30/D-7/D-1 알림을 APNs로 직접 발송. 기기 등록은 `POST /api/notifications/register`, entitlement는 `aps-environment`(Debug=development / Release=production) | 🟢 OK    | 기존 로컬 알림(저장 축제 리마인더·신규 발견 알림)은 그대로 분리 유지. 발송 시간 창(KST 9~21시)과 중복 방지 3층이 적용됨 |
| 즐겨찾기 / 설정 / 알림함 저장 위치 | 전부 기기 로컬(UserDefaults·App Group). CloudKit·서버 동기화 없음 | 🟠 P2    | **이번 출시에서는 의도적으로 유지한다**(사용자 결정). 로그인/클라우드 동기화 시스템을 새로 만들지 않는다. 기기 변경 시 즐겨찾기·알림함이 이전되지 않는다는 점을 스토어 설명이나 Settings에 한 줄 고지하는 것을 권장. 출시 후 CloudKit 동기화 검토 |
| 위젯 / Live Activity              | Medium `UpcomingFestivalsWidget` 출시 (2026-05-26) | 🟢 v1    | 다가오는 축제 3개 카드. Small/Large/Lock Screen/StandBy 위젯은 v1.1 후보                             |
| 다국어                            | 한국어 only                                        | 🟢 보류  | KR 한정이면 OK. 영어 추가 시 외국인 관광객 시장 확장 가능                                            |
| 다크모드                          | 구현됨(2026-09-11 확인) — `AppRootView.swift:119`가 `.preferredColorScheme(themeStore.isDarkMode ? .dark : .light)`, 토글은 `SettingsView.swift:330`, 팔레트는 `FestivalDesign.swift` | 🟢 OK    | **"시스템 설정 따름" 옵션이 없다** — 수동 토글 2택뿐이라 OS 다크모드를 켠 사용자도 앱은 라이트로 시작한다. 3택(시스템/라이트/다크)으로 넓히는 것을 권장(출시 후 가능) |
| 접근성 (Dynamic Type / VoiceOver) | 약함 — `accessibilityLabel`이 Swift 100개 파일 중 12개에만 있음(2026-09-11 실측, 이전 4/67) | 🟡 P1    | 지도 핀·필터 칩·카드에 label 보강, Dynamic Type Large까지 레이아웃 검증. TestFlight 빌드는 실기기에서 실행 확인됐지만 VoiceOver 통과 여부는 별개다 — **사용자 확인 필요** |
| 공유 확장 → 목적지 변환           | 구현됨                                             | 🟢 OK    | 카카오맵/네이버지도/카카오톡 공유 텍스트 케이스별 테스트                                             |
| AgentOffice (LLM head review) UI  | 구현됨                                             | 🟠 P2    | 사용자에게 "AI가 자동 검수합니다" 고지(생성형 AI 사용 표기) — Apple 4.0 가이드라인                   |

---

## 5. 데이터 / 콘텐츠 품질

| 항목                       | 현재 상태                       | 우선순위 | 권장 조치                                                                                                      |
| -------------------------- | ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| API 활용률                 | 6+4 fix 후 100% pagination 도달 | 🟢 OK    | 100% 활용 직후 cron 부담 / Worker 서브리퀘스트 한도 회귀 모니터 필요                                           |
| 데이터 출처 표기 | **앱에 없음**(2026-09-11 실측) — 1장 동일 항목 참고 | 🟡 P1 | Settings에 출처 화면 신설 |
| 이벤트 사진 저작권         | 외부 URL 참조                   | 🟠 P2    | hotlink 끊김 대비 R2 캐싱 + 출처 표기. 공식 출처 외 이미지 사용 시 라이선스 검토                               |
| 축제 종료/이전 데이터 정리 | `endDate < today` 필터          | 🟢 OK    | 정상                                                                                                           |
| 로컬 이벤트 신뢰도         | 자동승인 점수 0.75              | 🟡 P1    | 사용자 신고 채널(`POST /api/local-events/report`, `POST /api/event-reports`)이 있음 → 신고 누적 시 자동 강등 룰 추가                   |
| 행사 콘텐츠 밀도 (production 실측) | 진단 스크립트 추가 후 실행함 — `worker-backend/scripts/content-quality-report.mjs`(read-only, 의존성 없음). 2026-09-10T16:26Z, 반경 20km / 향후 180일 기준: 서울 축제 1,921건(진행중 563·예정 1,358), 인천 368(55·313), 수원 257(37·220), 부산 241(31·210), 대구 217(23·194). 전 지역 좌표 이상 0건·반경 밖 0건·종료 30일 초과 0건 | 🟢 OK | 축제·공연 밀도는 대표 5개 지역 모두 출시 가능한 수준이다. 스크립트는 `API_BASE_URL`/`RADIUS_KM`/`UPCOMING_DAYS` 환경변수로 다시 돌릴 수 있다 |
| 로컬 매장 이벤트 밀도      | **사실상 비어 있음** — 같은 실측에서 5개 지역 합계 11건(서울 3, 대구 8, 인천·수원·부산 각 0). 전 건 이미지 없음, 제목이 매장 행사명이 아니라 블로그 글 제목(서울 2/3, 대구 6/8), 대구 8건은 전부 `startDate 2026-09-09` + `endDate: null` | 🟡 P1 | 앱의 차별 포인트가 "동네 매장 이벤트"인데 현재 밀도로는 사용자가 빈 화면을 본다. 출시 자체를 막지는 않지만, (a) 서울 외 지역 수집 범위 확대, (b) 블로그 제목을 매장 행사명으로 정규화, (c) `endDate` 없는 건의 노출 기간 정책 정의가 필요. **운영 데이터는 이번에 수정하지 않았다** |
| 이미지 없는 행사           | 지역별 5~15% — 서울 98건(5%), 인천 23(6%), 수원 26(10%), 대구 23(11%), 부산 36(15%) | 🟠 P2    | `backfill-images` 파이프라인이 이미 돌고 있으므로 추세만 관찰. 부산이 가장 높다 |
| 상세 정보 부족 / 날짜 이상 | 수원 1건·대구 1건 상세 부족, 서울 1건 날짜 이상(`COLD FEET [No Filter]`) | 🟢 OK    | 1,000건 단위 대비 무시 가능한 수준. 대량 수정 불필요 |
| 데이터 중복/충돌           | 해결됨(2026-07-25) — `discoveryCache.ts`의 `dedupeFestivals`가 title+haversine 거리(≤1500m)+날짜range 겹침 기준으로 cross-provider 병합 (커밋 `499e401`, `33bd1d1`) | 🟢 OK    | 유지. 향후 로컬 이벤트에도 유사 cross-provider dedupe 필요성 발생 시 같은 패턴 적용 검토 |

---

## 6. 운영 / 모니터링

| 항목                     | 현재 상태                      | 우선순위 | 권장 조치                                                                        |
| ------------------------ | ------------------------------ | -------- | -------------------------------------------------------------------------------- |
| 에러 트래킹 (iOS)        | 외부 Crash SDK 없음 — **이번 출시 범위에서 도입하지 않기로 결정**(2026-09-11, 사용자 지시). 대신 조용히 무시되던 실패 경로 4곳(딥링크 파싱, 알림함 로드, `APIClient.post`, 두 위치 provider의 `didFailWithError`)에 `AppLogger` 로깅을 넣었고, 코드 전체에 `try!`·위험한 `fatalError`·크래시 유발 force unwrap이 없음을 확인 | 🟡 P1    | 출시 후 조기 도입 항목. Sentry SPM 추가 시 `PrivacyInfo.xcprivacy`에 CrashData/Performance 재선언 + ASC Privacy 답변 갱신이 함께 필요하다. 그때까지는 Xcode Organizer 크래시 리포트와 App Store Connect 크래시 로그가 유일한 관측 수단이다 |
| Worker 로그 집계         | Workers Logs 활성화됨 — `wrangler.toml` `[observability] enabled = true`, `head_sampling_rate = 1`(전량 수집) | 🟢 OK    | 대시보드 Workers → Logs 또는 `wrangler tail`로 조회. 장기 보관이 필요하면 Logpush(유료)를 검토 |
| Provider Health 대시보드 | `/providers/health` endpoint만 | 🟡 P1    | Grafana/Workers Analytics Engine 도입 → 시각 대시보드                            |
| Cron 실패 알림           | 코드가 production에 배포됨(`notifyOpsFailure` 20개 호출 지점) | 🟡 P1    | `OPS_ALERT_WEBHOOK_URL` secret이 실제로 설정되어 있는지는 코드로 확인 불가 — **사용자 확인 필요**(`npx wrangler secret list`). 미설정이면 알림 코드가 조용히 no-op이다. ⚠️ realtime cron 지속 실패 시 알림 빈발 가능 |
| D1 백업                  | 자동 백업 없음(2026-09-11 재확인 — 워크플로·Worker 코드에 export/backup 없음) | 🟡 P1    | `wrangler d1 export` 일일 R2 백업을 GitHub Actions cron으로 추가. 수집 데이터는 재수집 가능하지만 `local_events`(머천트 등록분)·`event_reports`는 복구 불가 |
| 사용자 피드백 채널       | 구현됨 — Settings "문의하기"(`SettingsView.swift:196`, mailto 링크). 같은 화면에 기기 로컬 저장·APNs 토큰 삭제 요청 경로 안내 있음 | 🟢 OK    | 행사 정보 오류 신고(`EventReportSheet` → `POST /api/event-reports`)도 별도로 있다 |
| 앱 버전 강제 업데이트    | 없음                           | 🟠 P2    | `/api/config` 로 minimum supported version 내려보내고 앱에서 강제 업데이트 모달  |

---

## 7. GTM / 마케팅

| 항목                                | 현재 상태                                | 우선순위 | 권장 조치                                                                                     |
| ----------------------------------- | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| 앱 스토어 스크린샷 (6.9") | 확보 — `docs/release/screenshots/` 5장, 1320×2868 8-bit RGB sRGB 알파 없음(2026-09-11) | 🟢 OK | CI 캡처(`.github/workflows/ios-screenshots.yml`, run `34614345570` @ `8054ae5`). 지도·목록·상세·상세 하단(주변 주차장 추천)·캘린더. `02-discover`/`03-detail`에 KOPIS 원본 데이터 문제가 보이므로 재캡처를 고려할 것 — `docs/release/screenshots/README.md` |
| 앱 미리보기 동영상                  | 없음                                     | 🟠 P2    | 15-30초 데모 — CTR 큰 차이                                                                    |
| 앱 이름 / 부제 / 검색 키워드 ASO    | 미확정                                   | 🟡 P1    | "이벤트다" 브랜드 + "축제 / 동네 이벤트 / 근처 주차" 키워드 100자 활용                        |
| 랜딩 페이지                         | 없음                                     | 🟡 P1    | `eventda.app` 또는 Worker `/` 에 소개 + 다운로드 링크 + 머천트 진입 분리                      |
| 머천트 영업 자료                    | 없음                                     | 🟡 P1    | "월 3,333원에 동네 손님 노출" 한 장짜리 PDF/landing                                           |
| 분석(Analytics)                     | 자체 익명 집계 구현됨 — `ios-app/Core/Services/AnalyticsService.swift` → `POST /api/analytics` → `analytics_daily`(migration `0030`). 사용자 식별자·좌표·검색어를 저장할 자리가 없고 allowlist 밖 이벤트는 서버가 버린다 | 🟢 OK    | 3rd-party SDK를 안 넣었으므로 Privacy Manifest·ATT 부담이 없다. 조회는 `GET /api/admin/analytics`. 퍼널 분석이 필요해지면 그때 외부 SDK를 검토 |
| Universal Links                     | URL Scheme만 존재 — Associated Domains entitlement 없음(2026-09-11 재확인) | 🟠 P2    | Associated Domains + apple-app-site-association. **URL scheme·App Group·BGTask identifier는 출시 직전 signing/딥링크 회귀 위험 때문에 이번에 건드리지 않는다**(사용자 지시) |
| 출시 사후 review 응대 SOP           | 없음                                     | 🟠 P2    | App Store Connect 리뷰 응답 템플릿(한/영) 준비                                                |

---

## 8. 품질 / 개발 인프라

| 항목                          | 현재 상태                                                                  | 우선순위 | 권장 조치                                                                          |
| ----------------------------- | -------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| iOS 빌드 검증                 | **통과** — build 296이 컴파일되고 TestFlight 업로드·실행까지 확인됨(2026-09-11, 사용자 보고). 이전 회차에서는 WSL2 환경에 Xcode가 없어 Swift 변경 11개 파일이 미검증 상태였다 | 🟢 OK    | 빌드 자체는 닫혔다. 남은 것은 접근성·다크모드·권한 거부 흐름의 개별 실기기 확인 |
| iOS 단위 테스트               | 3개 파일 — `ParkingLotNavigatorTests.swift`, `NotificationInboxTests.swift`, `NotificationRegionKeyTests.swift`(2026-09-11 실측, 이전 "1개 추정") | 🟡 P1    | 여전히 얇다. `FallbackLocation`·`NetworkErrorMessage`·`DeepLinkRouter`·APIClient 디코딩에 테스트 추가 권장. 시뮬레이터 빌드 워크플로(`ios-simulator-build.yml`)는 이미 있다 |
| 테스트 통과 현황              | worker-backend 36파일 310개 통과, backend 23파일 73개 통과, worker-backend typecheck 통과 (2026-09-11 실행) | 🟢 OK    | 유지                                                                               |
| backend pre-existing tsc 에러 | **2건이 아니라 그 이상**(2026-09-11 정정). 뿌리는 2건이다 — `tests/seoulProviderPagination.test.ts(122,3)` TS2739(`KOPIS_BASE_URL`·`KCISA_BASE_URL` 누락), `tests/workerLocalEvents.test.ts(2,57)` TS6059(rootDir 밖 import). 그런데 후자가 `worker-backend/src/localEvents.ts`를 backend 컴파일 범위로 끌어들여 TS6059·TS2552(`D1Database`)·TS2304(`D1Result`)·TS7006 등 연쇄 에러를 만든다 | 🟡 P1    | `workerLocalEvents.test.ts`의 cross-package import를 걷어내면 연쇄 에러가 통째로 사라진다. **worker-backend 쪽 typecheck는 깨끗하다**(exit 0) — 배포 경로에는 영향이 없다 |
| CI 게이트                     | **해결됨**(2026-09-11 정정) — `deploy-worker.yml`이 `verify`(worker `tsc --noEmit` → worker `pnpm test` → `pnpm --filter @parking/backend test`) → `migrate`(`apply-d1-migrations.yml`) → `deploy`(secret sync + `wrangler deploy`) → smoke test(`/health`·`/api/festivals`·`/api/performances` curl) → discovery cache refresh 순 체인이다. 앞 단계가 실패하면 배포되지 않는다 | 🟢 OK    | 이전 보고서의 "tsc만 통과하면 즉시 deploy" 서술은 더 이상 사실이 아니다. 남은 보강거리는 PR 단계 게이팅(현재는 master push 트리거만)과 `preflight` 추가 |
| Codemagic 빌드 번호 자동 증가 | 수동 (`CURRENT_PROJECT_VERSION` 296, `MARKETING_VERSION` 1.0, 2026-09-11 기준) | 🟠 P2    | `CI_BUILD_NUMBER` 또는 codemagic.yaml `agvtool` 자동                               |
| Worker 환경 분리              | prod 단일                                                                  | 🟠 P2    | staging Worker + staging D1 분리. 머천트 결제·LLM head agent 회귀 테스트용         |
| 의존성 보안 점검              | 없음                                                                       | 🟠 P2    | Dependabot/Renovate, `pnpm audit` CI 게이트                                        |
| Feature Flag                  | 없음                                                                       | 🟠 P2    | "이벤트 100% 모드", "AgentOffice 노출" 등 토글. 단순 KV 1개로도 충분               |
| 레거시 내부 명칭              | `ParkingLotNavigator`(타깃·클래스·테스트), bundle identifier 계열, URL scheme `parkingnavigator://`, App Group, BGTask identifier `com.parkingnav.discovery.refresh`가 앱 이름 "이벤트다"와 어긋난다 | 🟠 P2    | **이번 출시에서는 rename하지 않는다**(사용자 결정) — 출시 직전 signing·딥링크·백그라운드 태스크 회귀 위험이 이득보다 크다. 사용자에게 보이는 표시명만 "이벤트다"면 심사에 문제가 없다. 기술 부채로 기록하고 다음 메이저에서 정리 |
| D1 무료 한도 대응             | 조건부 쓰기·인덱스 정리 적용 후 production 배포됨. cron 슬롯 1/5 사용, Queue op·subrequest 예산은 코드 대조로 재확인(2026-09-11) | 🟡 P1    | **D1 일일 행 쓰기만 `실측 필요`** — 깨끗한 24시간 창을 아직 못 쟀다. 절차·명령·현재 막힌 지점(`wrangler d1 insights`가 `Authentication error [code: 10000]`, Account Analytics Read 권한 토큰 필요)은 `docs/operations/worker-limits.md` 참고 |

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

## 10. 즉시 차단 P0 정리

> 2026-09-11 기준(TestFlight 검증 + 스크린샷 확보 반영). **지금 제출을 실제로 막는 것은 앱 소개 문구 하나뿐이다.** Toss 라이브 키·사업자등록은 결제를 켜는 시점의 차단 요소이고, 결제를 끈 채 출시하면 이번 제출을 막지 않는다.

| #   | 항목                                         | 현재 상태                   | 남은 산출물                                                |
| --- | -------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| 1 | `PrivacyInfo.xcprivacy` | ✅ 해결 — `ios-app/Resources/PrivacyInfo.xcprivacy` 존재, 1st-party 정합성 정리 완료. `99f2fc2`로 검색 기록 서버 수집이 사라져 App Privacy 답변과 코드가 일치한다 | 없음 |
| 2 | 개인정보처리방침 호스팅 URL + ASC 입력 | ✅ 완료 — `GET /legal/privacy` HTTP 200 (2026-09-11 실측), ASC App Privacy 입력 완료 (2026-09-11, 사용자 확인) | 없음 |
| 3 | 이용약관 + 환불·취소 정책 | ✅ 배포 완료 — `/legal/terms`, `/legal/refund-policy` 모두 HTTP 200 | 앱 Settings에 **환불·취소 정책 링크가 없다**(개인정보 처리방침·이용약관만 있음). 결제를 켜는 시점에는 필수 |
| 4 | iOS 크래시 트래킹 | 🟡 P1 — 이번 출시 범위에서 도입하지 않기로 결정(2026-09-11, 사용자 지시). 외부 SDK가 없으므로 PrivacyInfo의 "크래시 데이터 미수집" 선언과 정합 | 출시 후 Sentry/Crashlytics 검토. 그동안은 `AppLogger` + Workers Logs가 유일한 관측 수단 |
| 5 | App Store 스크린샷 | 🟢 해결 (2026-09-11) | `docs/release/screenshots/`에 6.9" 규격 5장(1320×2868, sRGB, 알파 없음). 로컬 Mac 없이 `.github/workflows/ios-screenshots.yml`을 수동 실행해 macOS 러너 시뮬레이터에서 캡처했다(run `34614345570` @ `8054ae5`). 남은 산출물은 앱 소개 문구다 |
| 6 | Toss 라이브 키 + 사업자등록 | 🔴 P0 (**수익화 시점 한정**) — `wrangler.toml:60`이 아직 `test_gck_docs_...` 문서용 테스트 키 | 결제 기능을 켠 채 제출하면 심사에서 막힌다. 결제 없이 출시하면 이번 제출과 무관 |
| 7 | iOS 빌드 / TestFlight | ✅ 완료 — build 296 컴파일 성공, TestFlight 업로드·실행 확인 (2026-09-11, 사용자) | 없음 |

---

## 11. 권장 로드맵

제출 직전 (남은 것)

- 앱 소개 문구(이름·부제·설명·키워드) 확정 — **유일한 P0**. 스크린샷 5장은 `docs/release/screenshots/`에 확보됐다
- `OPS_ALERT_WEBHOOK_URL` secret이 실제로 설정돼 있는지 확인 (`npx wrangler secret list`)
- 실기기 VoiceOver / 다크모드 / 위치 권한 거부 흐름 손으로 한 번 — TestFlight 실행 확인은 앱이 뜬다는 것까지이고 이 셋은 별개다
- Kakao Mobility SDK 상용 사용 조건, 심사용 데모 계정 필요 여부 확인
- 앱 내 데이터 출처 표기 한 줄 추가 — 공공데이터 기반 앱에서 리젝 사유가 될 수 있다

완료됨 (2026-09-11)

- iOS build 296 컴파일 + TestFlight 업로드·실행 확인
- ASC App Privacy 입력

출시 직후 30일

- D1 일일 행 쓰기 24시간 실측 (`docs/operations/worker-limits.md`의 절차, Account Analytics Read 토큰 필요)
- 이미지 없는 행사 비율(수원 10% · 대구 11% · 부산 15%) 개선 — `imageBackfill` 커버리지 확대
- 로컬 매장 이벤트 밀도 확대 (5개 지역 합계 11건은 "로컬 이벤트 앱"으로 보이기에 부족)
- 오프라인 캐시 최소판 (현재는 네트워크 실패 시 구분된 메시지 + 재시도만 있다)
- 앱 내 데이터 출처 표기 화면 추가 (현재 앱 어디에도 없다)

30~90일

- iOS 크래시 트래킹 SDK 도입 (Privacy Manifest 호환 버전)
- 즐겨찾기·설정·알림함 클라우드 동기화 (지금은 전부 device-local, 기기 바꾸면 사라진다)
- 레거시 명칭(`ParkingLotNavigator` 계열) 정리 — signing·딥링크 회귀를 감당할 수 있는 시점에
- Universal Links (Associated Domains + apple-app-site-association)
- Toss 가맹점 가입 후 라이브 키 전환, 머천트 환불 SOP
- D1 백업/내보내기 cron (`local_events`·`event_reports`는 지금 복구 수단이 없다)

---

부록 — 이 보고서의 판정은 2026-09-11 기준 코드·설정·production 응답 실측에서 나왔다. 이번 회차는 read-only 점검이 아니라 iOS UX 수정(위치 권한 타이밍, 지역 기본값, 네트워크 오류 문구)을 동반했고, 그 변경 내역은 4장에 반영돼 있다. production 데이터는 읽기만 했고 수정하지 않았다.
