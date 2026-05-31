# Inspection Map

보고서 섹션별로 "어디를 실제로 봐야 근거가 나오는지" 정리한 표다. 보고서가 다루는 영역에 맞춰 참고하되, 보고서의 섹션 구성이 우선이다. 모든 판단은 추정이 아니라 아래 위치의 실제 내용/명령 결과로 한다.

## 1. Apple 심사 / 법무
- `ios-app/` 안 `PrivacyInfo.xcprivacy` 존재 여부 (`rg --files -g 'PrivacyInfo.xcprivacy'`)
- `ios-app/**/Info.plist`의 `NS*UsageDescription` 문구 (위치/카메라/사진 등)
- `ios-app/project.yml`의 `ITSAppUsesNonExemptEncryption`, bundle 설정
- `docs/privacy/`, `docs/release/` 법무 산출물(약관/환불정책/개인정보) 존재 여부
- Worker `/legal/*` 라우트 존재 여부 (`rg -n "legal" worker-backend/src`)
- 외부 URL 호스팅 완료 여부는 코드로 확인 불가 → 사용자 확인 필요

## 2. 보안 / 개인정보 운영
- Worker rate limit / CORS 설정 (`rg -n "cors|rateLimit|origin" worker-backend/src`)
- 시크릿이 코드/커밋에 평문 노출됐는지 (`.dev.vars`, xcconfig 실제값은 커밋 금지)
- admin 토큰 처리, 로그 PII 필터

## 3. 머천트 / 결제 / 수익 모델
- Toss 키가 test(`test_`)인지 live(`live_`)인지 — 코드/설정 참조, 실제 시크릿 값은 보지 않음
- 환불/취소 흐름 라우트, 약관 동의 체크 구현 여부
- `rg -n "toss|merchant|refund|cancel" worker-backend/src`

## 4. 제품 / UX 완성도
- `ios-app/` 주요 화면/기능 구현 상태, TODO/FIXME, 임시 디버그 코드
- 온보딩/푸시/위젯 등 retention 장치 존재 여부

## 5. 데이터 / 콘텐츠 품질
- `worker-backend/src/localEventDiscovery.ts` 수집 로직 상태
- D1 마이그레이션 정합성 (`worker-backend/migrations/`)
- approved/pending 노출 정책, 좌표 누락 등은 코드 레벨까지만 확인 (실데이터는 사용자 확인)

## 6. 운영 / 모니터링
- Cron/스케줄, 실패 알림, 백업 절차 (`worker-backend/wrangler.toml`의 triggers/crons)
- 모니터링/로깅 연동 흔적

## 7. GTM / 마케팅
- 대부분 저장소 밖 → 코드 근거 거의 없음. 추측으로 닫지 말 것.

## 8. 품질 / 개발 인프라
- `pnpm -C worker-backend typecheck` 결과
- `pnpm --filter @parking/backend test` / `preflight` 결과
- CI 설정 (`.github/workflows/`, `codemagic.yaml`)
- `shared-types` ↔ Worker schema ↔ backend route schema 정합성

## 9~11. 확장 아이디어 / P0 정리 / 로드맵
- 1~8의 갱신 결과에서 파생. 표의 실제 🔴 항목과 P0 정리가 일치하도록 동기화.

## 확인 불가 영역 (저장소만으로 검증 안 되는 것들)
사업자등록·통신판매업신고, 외부 URL 게시 완료, App Store Connect 입력/스크린샷, 외부 SDK 상용 계약, 법무 검토 — 이런 항목은 코드 근거가 없으므로 상태를 임의로 바꾸지 말고 "사용자 확인 필요"로 둔다.
