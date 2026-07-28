# 시/군/구 사이트 축제 크롤러 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this into an implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to execute it.

**목표:** 공공 API(전국문화축제표준데이터·TourAPI·KOPIS 등)에 등록되지 않은 소규모 지역 축제를 채우기 위해, 전국 시/군/구 문화관광 홈페이지를 크롤링하는 배치 파이프라인을 구축한다. 226개 시/군/구 전체를 최종 목표로 하되, 15~20곳 파일럿부터 단계적으로 확장한다.

**아키텍처 요약:** 새 배치 잡이 설정된 사이트 목록을 순회하며 HTML을 파싱해 D1에 적재하고, 이 D1을 읽기만 하는 얇은 `FestivalProvider`가 기존 `festivalService` → discovery cache cron → 앱 서빙 파이프라인에 그대로 올라탄다. 새로운 서빙 경로나 iOS 변경은 없다.

**기술 스택:** Cloudflare Workers (worker-backend), D1, cheerio(신규 의존성, HTML 파싱), 기존 `FestivalProvider` 인터페이스.

## Global Constraints

- 크롤링은 공개 페이지만 best-effort로 읽는다. 우회 헤더, 로그인 세션, 내부 API 역호출을 추가하지 않는다 (CLAUDE.md 기존 정책과 동일).
- 이미지는 원본 URL 문자열만 저장한다. 다운로드, 재호스팅, 리사이즈를 하지 않는다.
- 사이트 하나의 실패(HTTP 오류, 파싱 예외)가 전체 배치 실행을 중단시키지 않는다.
- D1 스키마 변경은 반드시 새 migration으로 추가한다. 기존 migration은 수정하지 않는다.
- 신뢰 점수 임계값 미만인 항목은 D1에 쓰지 않는다(자동 게시, 별도 승인 큐 없음).
- robots.txt는 사이트를 config에 등록하는 시점에 사람이 확인하고, 확인 결과를 config 주석에 남긴다. 런타임 자동 검사는 이번 스코프에 포함하지 않는다.

---

## 아키텍처

```
cron (일 1회) → cityFestivalDiscovery.ts
                   ├─ CitySiteConfig[] 순회 (파일럿: 15~20곳)
                   ├─ 사이트별 fetch → 파싱(선언형 셀렉터 | customParser)
                   ├─ 정규화(제목/날짜/좌표/이미지 URL) + 신뢰 점수 계산
                   └─ 점수 통과 항목만 D1 city_festivals에 upsert

기존 파이프라인 (변경 없음):
  discoveryCache.ts 청크 cron → backend.festivalService.nearby(query)
    → [TourApiFestivalProvider, NationalCultureFestivalProvider, ...,
       CityScrapedFestivalProvider]  ← 신규 provider가 여기 추가됨
    → dedupeFestivals() (제목/날짜/좌표 기준, source 우선순위로 승자 결정)
    → festivals 캐시 테이블 upsert
    → /api/festivals, /api/map/items 가 캐시에서 서빙 (변경 없음)
```

핵심은 두 파이프라인의 분리다. 느리고 신뢰도가 낮은 "외부 사이트 fetch"는 별도 배치가 하루 한 번만 수행하고, 실시간 요청 경로(`FestivalProvider.festivals(query)`)에 들어가는 `CityScrapedFestivalProvider`는 D1을 읽기만 하는 빠른 쿼리로만 동작한다(`staticParkingCache.ts`와 동일한 패턴).

## 컴포넌트

### 1. `worker-backend/src/cityFestivalSites.ts` (신규)

파일럿 사이트 설정 배열. 사이트 추가는 이 파일에 항목을 추가하는 것으로 이루어진다(관리 UI 없음 — 이 규모에서는 과함).

```typescript
export interface CitySiteConfig {
  siteId: string;
  cityName: string;
  listUrl: string;
  fallbackLat: number;  // 지자체 청사 좌표 (행사별 좌표 못 구했을 때 폴백)
  fallbackLng: number;
  robotsCheckedAt: string;   // "2026-07-28" — 등록 시점에 사람이 robots.txt 확인한 날짜
  selectors?: {
    itemSelector: string;
    titleSelector: string;
    dateSelector: string;
    linkSelector: string;
    imageSelector?: string;
  };
  customParser?: string;  // customParsers 레지스트리의 키. selectors 대신 사용.
}

export const CITY_FESTIVAL_SITES: CitySiteConfig[] = [
  // 파일럿 15~20곳
];
```

### 2. `worker-backend/src/cityFestivalParsers/` (신규 디렉터리)

- `declarativeParser.ts`: `selectors` 기반 범용 파서. cheerio로 `listUrl`을 파싱해 `itemSelector`로 목록 항목을 찾고, 각 항목에서 제목/날짜/링크/이미지를 추출.
- `customParsers/<siteId>.ts`: 선언형으로 표현 안 되는 사이트(예: 계룡시처럼 JS에 임베드된 JSON) 전용 파서 함수. `customParsers/index.ts`가 `siteId → parser 함수` 레지스트리로 export.
- 모든 파서의 출력 타입은 공통 `RawCityFestivalCandidate`:

```typescript
interface RawCityFestivalCandidate {
  title: string | null;
  startDateRaw: string | null;
  endDateRaw: string | null;
  venueRaw: string | null;
  addressRaw: string | null;
  detailUrl: string | null;
  imageUrl: string | null;
}
```

### 3. `worker-backend/src/cityFestivalDiscovery.ts` (신규)

- `runCityFestivalDiscovery(db: D1Database, env: Env): Promise<{ processed: number; published: number; failedSites: string[] }>`
- `CITY_FESTIVAL_SITES`를 순회. 사이트별로 `try/catch`, 실패는 `failedSites`에 site id를 push하고 계속.
- 각 사이트: `selectors`가 있으면 `declarativeParser`, `customParser`가 있으면 레지스트리에서 찾아 실행.
- `RawCityFestivalCandidate[]` → 정규화(날짜 파싱, 좌표 결정 — 주소 있으면 기존 geocode 캐시 사용, 없으면 `fallbackLat/Lng`) → 점수 계산 → 임계값 통과 항목만 D1 upsert.
- `localEventDiscovery.ts`와 마찬가지로 사이트 간 fetch에 짧은 딜레이(예: 300ms)를 둔다.

### 4. D1 신규 테이블 `city_festivals` (신규 migration)

```sql
CREATE TABLE city_festivals (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  venue TEXT,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  image_url TEXT,
  score REAL NOT NULL,
  scraped_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_city_festivals_site_title_start
  ON city_festivals(site_id, title, start_date);
CREATE INDEX idx_city_festivals_lat_lng ON city_festivals(lat, lng);
```

`id`는 `` `${siteId}:${normalizedTitle}:${startDate}` `` 해시로 생성해 upsert 키로 쓴다.

### 5. `worker-backend/src/cityFestivalCache.ts` (신규, `staticParkingCache.ts`와 동일 패턴)

```typescript
export async function queryCityFestivalsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  radiusMeters: number,
  upcomingWithinDays: number
): Promise<CityFestivalRow[]>
```

`staticParkingCache.ts`의 경험(ORDER BY 없는 LIMIT가 결과를 왜곡시킨 버그)을 반영해, 처음부터 거리 기준 `ORDER BY`를 포함한다.

### 6. `CityScrapedFestivalProvider` (신규, `worker-backend/src/cityScrapedFestivalProvider.ts`)

`backend/src/features/discover/common/discoverProvider.ts`의 `FestivalProvider` 인터페이스를 구현. 생성자로 `D1Database`를 받고, `festivals(query)`는 `queryCityFestivalsFromCache()` 결과를 `Festival` shape로 매핑해 반환(외부 fetch 없음, D1 SELECT만).

### 7. 기존 파일 수정

- `backend/src/features/discover/festivals/festivalService.ts`: `createFestivalService(extraProviders: FestivalProvider[] = [])` — `providers.push(...extraProviders)` 한 줄 추가. `sourcePriority()`에 `city-scraped` 항목을 최하위 우선순위로 추가.
- `worker-backend/src/index.ts`의 `importBackend()`: `festivalService: createFestivalService(env.DB ? [new CityScrapedFestivalProvider(env.DB)] : [])`.
- `worker-backend/wrangler.toml`: `crons` 배열에 `"0 4 * * *"` 추가.
- `worker-backend/src/index.ts`의 `scheduled()`: `controller.cron === "0 4 * * *"` 분기에서 `runCityFestivalDiscovery(env.DB, env)` 호출, 실패 시 기존 `notifyOpsFailure` 패턴으로 알림.
- 수동 스모크 테스트용 `POST /admin/sync-city-festivals` 엔드포인트 추가 (`/admin/sync-local-events`와 동일한 인증 방식, `SYNC_ADMIN_TOKEN`).

## 신뢰 점수

`worker-backend/src/cityFestivalScore.ts` (신규):

```typescript
function scoreCandidate(normalized: NormalizedCityFestival): number {
  let score = 0;
  if (normalized.title && normalized.title.length >= 2) score += 0.3;
  if (normalized.startDate && normalized.endDate && normalized.startDate <= normalized.endDate) score += 0.3;
  if (isWithinKoreaBounds(normalized.lat, normalized.lng)) score += 0.2;
  if (normalized.detailUrl) score += 0.2;
  return score;
}
```

`CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE` (env var, 기본 0.7) 이상만 D1에 쓴다. 좌표는 주소가 있으면 기존 geocode 캐시(`eventProviderUtils.ts`의 `getGeocodeStore`)로 변환을 시도하고, 실패하거나 주소 자체가 없으면 `fallbackLat/Lng`(지자체 청사 좌표)로 대체한다 — 이 경우도 좌표 자체는 유효하므로 점수에 불이익을 주지 않는다.

## 에러 처리

- 사이트별 fetch: 10초 타임아웃, 실패 시 로그(`console.error`)만 남기고 다음 사이트로.
- 파싱 예외(선언형 셀렉터가 아무것도 못 찾음, customParser가 throw): 동일하게 catch하고 계속.
- 배치 전체가 실패(예: D1 연결 자체가 안 됨)하는 경우만 `notifyOpsFailure`로 운영 알림.
- `runCityFestivalDiscovery()`의 반환값(`processed`, `published`, `failedSites`)을 `/admin/sync-city-festivals` 응답 바디와 cron 로그 양쪽에 남겨서, 사이트별 성공/실패를 배포 후 바로 확인할 수 있게 한다.

## 테스트

- `worker-backend/src/cityFestivalParsers/declarativeParser.test.ts`: 저장된 HTML fixture(가평군 게시판, 서울 문화포털 등 구조가 다른 샘플 2~3개)를 입력으로 선언형 파서가 올바르게 항목을 추출하는지 검증.
- `worker-backend/src/cityFestivalScore.test.ts`: 정상 케이스, 날짜 누락, 좌표 이상, 링크 없음 등 케이스별 점수 계산 검증.
- `worker-backend/src/cityFestivalDiscovery.test.ts`: 사이트 하나가 throw해도 나머지가 처리되는지(best-effort 동작) 검증 — 파서를 mock으로 교체.
- 파일럿 배포 후 `curl -X POST -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" .../admin/sync-city-festivals`로 실제 사이트 대상 스모크 테스트, 응답의 `failedSites`로 실패 사이트 확인.

## 스코프 밖 (이번 설계에 포함하지 않음)

- 226곳 전체 config 작성 — 파일럿 15~20곳만 이번 스펙 대상. 확장은 파일럿 결과를 보고 별도로 진행.
- robots.txt 런타임 자동 검사.
- 관리자용 사이트 config 편집 UI.
- JS 렌더링이 필요한(임베디드 JSON이 아니라 진짜 클라이언트 사이드 렌더링) 사이트 지원 — 파일럿에서 발견되면 해당 사이트는 건너뛰고 기록만 남긴다.
