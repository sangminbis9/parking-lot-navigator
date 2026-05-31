#!/usr/bin/env bash
# readiness-review 공통 근거 수집 스크립트.
# 비파괴(read-only)만 수행한다. 개별 명령 실패는 무시하고 계속 진행한다.
# 사용법: bash gather-evidence.sh [지난_점검_커밋_또는_날짜]
#   인자가 커밋(ref)이면 그 이후 git 로그, 날짜(YYYY-MM-DD)면 --since 로그를 보여준다.
# 출력은 사람이 읽는 evidence 요약일 뿐, 항목별 최종 판단은 호출자가 직접 한다.

set +e
SINCE="$1"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 0

section() { printf '\n===== %s =====\n' "$1"; }

section "현재 위치/커밋"
echo "ROOT: $ROOT"
git rev-parse --short HEAD 2>/dev/null | sed 's/^/HEAD: /'
git rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's/^/branch: /'
git status --short 2>/dev/null | sed 's/^/dirty: /' | head -40

section "지난 점검 이후 변경 (since=${SINCE:-미지정})"
if [ -n "$SINCE" ]; then
  if git rev-parse --verify --quiet "$SINCE" >/dev/null 2>&1; then
    git log --oneline "$SINCE"..HEAD 2>/dev/null | head -60
  else
    git log --oneline --since="$SINCE" 2>/dev/null | head -60
  fi
else
  echo "(인자 없음 — 최근 30 커밋)"
  git log --oneline -30 2>/dev/null
fi

section "주요 릴리스/법무 산출물 존재 여부"
for p in \
  "ios-app" \
  "docs/privacy" \
  "docs/release/deployment-readiness-report.md" \
  "docs/legal" \
  "worker-backend/wrangler.toml" \
  ".github/workflows" \
  "codemagic.yaml" ; do
  if [ -e "$p" ]; then echo "OK   $p"; else echo "없음  $p"; fi
done
echo "-- PrivacyInfo.xcprivacy:"
find ios-app -name 'PrivacyInfo.xcprivacy' 2>/dev/null | sed 's/^/  /' || true
echo "-- Worker /legal 라우트 흔적:"
grep -rn "legal" worker-backend/src 2>/dev/null | head -10 || true

section "iOS 빌드 번호 (project.yml)"
grep -nE "CURRENT_PROJECT_VERSION|MARKETING_VERSION" ios-app/project.yml 2>/dev/null | head -10 || true

section "D1 마이그레이션 목록"
ls -1 worker-backend/migrations 2>/dev/null | sed 's/^/  /' || echo "  (migrations 폴더 없음)"

section "Toss 키 모드 흔적 (test/live)"
grep -rnE "test_gck|test_gsk|live_gck|live_gsk|TOSS_" worker-backend/src 2>/dev/null | head -10 || true

section "CORS / rate limit 흔적"
grep -rnE "cors|rateLimit|origin:" worker-backend/src 2>/dev/null | head -10 || true

section "TODO/FIXME (코드 한정, 상위 20)"
grep -rnE "TODO|FIXME" worker-backend/src ios-app backend/src 2>/dev/null | head -20 || true

section "끝"
echo "위 신호는 출발점이다. typecheck/test 등 명령 실행과 항목별 판단은 SKILL.md 흐름대로 직접 수행할 것."
