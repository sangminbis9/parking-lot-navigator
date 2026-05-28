# CLAUDE.md

이 저장소에서 작업할 때 Claude가 따라야 할 프로젝트 운영 지침입니다. 답변은 기본적으로 한국어로 하고, 사용자가 코드 변경을 요청하면 분석만 하지 말고 가능한 범위에서 직접 수정, 검증, 커밋/푸시까지 진행합니다.

## 프로젝트 개요

- `ios-app/`: SwiftUI iOS 앱, XcodeGen 기반 프로젝트.
- `worker-backend/`: Cloudflare Worker + Hono + D1 운영 API. 실제 배포 API는 이쪽이 중심이다.
- `backend/`: 로컬 Fastify 백엔드와 provider/test 코드.
- `shared-types/`: iOS/백엔드/Worker가 공유하는 TypeScript DTO 타입.
- `docs/`: 운영, 배포, 개인정보, 아키텍처 문서.

앱의 핵심 기능은 목적지 주변 주차장, 축제, 로컬 매장 이벤트를 지도와 리스트로 보여주는 것이다.

## 중요한 도메인 규칙

- 기존 공공 API 기반 "이벤트" 데이터는 현재 "축제" 도메인으로 취급한다.
- 새 "이벤트"는 식당/카페/상점/로컬 매장의 할인, 무료 제공, 리뷰 이벤트, 팝업, 한정 메뉴, 오픈 이벤트 등을 의미한다.
- 축제와 로컬 이벤트는 DB, API response, UI filter, map marker type에서 분리한다.
- 로컬 이벤트 D1 테이블은 `local_events`이고, 지도 item type은 `event`, marker type은 `local_event`이다.
- 로컬 이벤트는 기본적으로 `approved` 상태만 앱 API에 노출된다. `pending` 데이터가 많으면 앱에서는 비어 보일 수 있다.

## 현재 로컬 이벤트 수집 구조

현재 production provider는 `worker-backend/src/localEventDiscovery.ts`의 `naver_place_feed_kakao_local`이다.

수집 흐름:

1. Kakao Category Search로 전국 주요 지역의 음식점(`FD6`)과 카페(`CE7`) 업체 후보를 수집한다.
2. Naver Local Search API로 Kakao 업체와 매칭되는 Naver Place ID/링크를 찾는다.
3. Naver Place feed 공개 HTML에서 임베디드 JSON/텍스트를 읽어 이벤트 키워드를 찾는다.
4. 혜택, 날짜, 매장명, 주소, 좌표, 원본 링크를 구조화한다.
5. 점수 기준을 만족하면 `approved`, 아니면 `pending`으로 저장한다.

중요:

- 더 이상 Naver Blog Search를 메인 수집에 사용하지 않는다.
- Instagram 무단 HTML 크롤링, 로그인 세션 흉내, 봇 탐지 우회, 비공식 API 호출은 금지한다.
- Naver Place feed도 공개 페이지를 best-effort로 읽는 수준만 허용한다. 우회 헤더, 로그인 쿠키, 내부 API 역호출을 추가하지 않는다.
- 게시물 이미지 원본을 무단 저장하지 않는다. 가능하면 원본 링크 또는 허용된 이미지 URL만 참조한다.
- 댓글 작성자, 개인 계정, 개인정보는 저장하지 않는다.

주요 설정:

- `LOCAL_EVENT_PROVIDER_ENABLED`
- `LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE`
- `LOCAL_EVENT_SEARCH_MAX_QUERIES`
- `LOCAL_EVENT_MAX_PLACES_PER_REGION_CATEGORY`
- `KAKAO_CATEGORY_RADIUS_METERS`
- `KAKAO_CATEGORY_MAX_PAGES`
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`
- `KAKAO_REST_API_KEY`

## 자주 쓰는 명령

루트에서 실행:

```bash
pnpm install
pnpm -C worker-backend typecheck
pnpm -C worker-backend deploy
pnpm --filter @parking/backend test
pnpm --filter @parking/backend preflight
```

Worker D1 마이그레이션:

```bash
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/<migration>.sql
```

로컬 이벤트 수동 sync:

```bash
curl -X POST \
  -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" \
  "https://parking-lot-navigator-api.parkingnav.workers.dev/admin/sync-local-events"
```

주의:

- Worker 코드만 바꾼 경우 iOS/Codemagic 빌드는 필요 없다. Worker deploy와 필요한 D1 migration/sync가 핵심이다.
- Swift/iOS UI를 바꾼 경우에만 Codemagic 또는 Xcode 빌드를 고려한다.
- D1 schema를 바꾸면 반드시 새 migration을 추가한다. 기존 migration을 임의 수정하지 않는다.

## API 기준

주요 endpoint:

- `GET /api/festivals`
- `GET /api/local-events`
- `GET /api/local-events/:id`
- `POST /api/local-events/report`
- `POST /api/admin/local-events`
- `PATCH /api/admin/local-events/:id/status`
- `PATCH /api/admin/local-events/:id`
- `GET /api/map/items?type=festival|event|all`
- `POST /admin/sync-local-events`

앱에서 이벤트가 안 보일 때 먼저 확인할 것:

1. Worker가 최신 master로 deploy 되었는가.
2. 필요한 D1 migration이 remote에 적용되었는가.
3. `/admin/sync-local-events`가 성공했는가.
4. `local_events.status`가 `approved`인가.
5. 좌표가 `0`이거나 `NULL`이 아닌가.
6. 앱 요청의 `lat/lng/radiusMeters` 범위 안에 이벤트가 있는가.
7. Naver/Kakao API key가 Worker secret/vars에 설정되어 있는가.

## 개발 원칙

- 작업 전 `git status --short`로 현재 변경 상태를 확인한다.
- 사용자가 만들었을 수 있는 변경을 되돌리지 않는다.
- 검색은 우선 `rg` 또는 `rg --files`를 사용한다.
- 불필요한 리팩터링을 피하고 요청 범위에 맞게 수정한다.
- 타입 변경은 `shared-types`, Worker schema, backend route schema, D1 migration이 서로 맞는지 확인한다.
- 수집/동기화 로직은 개별 provider 실패가 전체 sync를 죽이지 않도록 best-effort로 처리한다.
- 비밀키, 토큰, `.env`, `.dev.vars`, xcconfig 실제값은 커밋하지 않는다.

## 검증 기준

Worker 변경 시 최소:

```bash
pnpm -C worker-backend typecheck
```

Backend provider나 shared backend logic 변경 시:

```bash
pnpm --filter @parking/backend test
pnpm --filter @parking/backend preflight
```

iOS 변경 시:

- XcodeGen 프로젝트 파일 생성 여부 확인.
- 가능한 경우 Xcode/Codemagic 빌드 확인.
- 앱 빌드 번호를 올려야 하는 배포 작업인지 구분한다.

## Git 운영

- 사용자가 커밋/푸시를 요청하면 `master`에 커밋 후 `git push origin master`까지 진행한다.
- 커밋 전 타입체크/테스트 결과를 확인한다.
- 커밋 메시지는 구체적으로 쓴다. 예: `Expand local event discovery nationwide`.
- `git reset --hard`, `git checkout --`, 강제 push 같은 파괴적 명령은 사용자가 명시적으로 요청한 경우에만 사용한다.

## 응답 방식

- 사용자가 "해야 할 일"을 물으면 앱 빌드, Worker deploy, D1 migration, sync 중 무엇이 필요한지 명확히 구분한다.
- 작업 결과는 변경 파일, 검증 명령, 커밋 해시, 다음 배포/운영 단계 위주로 짧게 보고한다.
- 문제가 남아 있으면 숨기지 말고 원인과 다음 확인 지점을 구체적으로 말한다.

## 응답 마무리 형식

작업 완료 응답 끝에 반드시 아래 섹션을 ## 헤딩+이모지로 추가한다 (번호/볼드 금지).

- **📋 진행 요약**: 이번 턴에 한 일 (변경 파일·결과 등 구체적으로)
- **🧭 다음 추천 작업**: 후속 없으면 섹션 전체 생략
- **🚀 Git 명령**: git 변경 없으면 생략. 한 줄 `&&` 체인으로.
- **📱 iOS/Codemagic 빌드 필요 여부**: 항상 한 줄 "iOS 빌드 필요: 예/아니오"
  - 예: ios-app/ 내 Swift·asset·xcconfig·project.yml·Info.plist 변경 시. 이때 ios-app/project.yml CURRENT_PROJECT_VERSION +1 Edit 수행 후 새 값 안내, git add에 포함.
  - 아니오: worker-backend·backend·shared-types·docs·루트 md/json 등 변경 시.
