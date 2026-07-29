# 도시별 축제 스크래퍼 226개 사이트 확장 — 설계

## 배경

`2026-07-28-city-festival-scraper-design.md`에서 5개 시/군(순창군, 평택시, 경산시, 통영시, 정선군) 파일럿을 구축·배포했다. 그 스펙은 226개 시/군/구 전체 확장을 의도적으로 스코프 밖으로 뒀다("확장은 파일럿 결과를 보고 별도로 진행"). 파일럿 운영 중 Task 12 최종 리뷰에서 확장 전 반드시 해결해야 할 두 가지 구조적 문제가 발견됐다:

- **I3**: 3개 파서(declarative + custom 2개) 전부 `addressRaw`를 `null`로 고정 → `resolveCoordinates()`가 항상 시청 좌표(`fallbackLat/Lng`)로 폴백. 사이트 수가 늘수록 좌표 뭉침이 심해진다.
- **I4**: `runCityFestivalDiscovery()`가 전체 사이트를 한 번의 실행에서 순회하고 `db.batch()` 한 번에 처리 — 5개 사이트는 문제없지만 226개로 늘면 CPU 시간 초과 위험이 있다(이 저장소에는 이미 비슷한 이유로 discovery cache 새로고침을 청크로 쪼갠 선례가 있다: 커밋 7447d14).

이 문서는 226개 전체를 향한 단계적(wave) 확장의 **인프라**와, 그 인프라를 검증하는 **첫 wave(충청남도 15개 시/군)** 를 설계한다. wave 3 이후 나머지 ~196개 사이트는 이 플랜의 스코프 밖이며, 같은 방법론을 반복 적용하는 별도 작업으로 남긴다.

## 스코프

**포함**:
1. 일별 청킹 인프라(`cityFestivalSchedule.ts`) — 사이트 수가 늘어도 하루 실행량을 일정하게 유지
2. I3 해결 — 파서의 주소/장소 텍스트 추출 + Kakao geocoding 실배선
3. Wave 2: 충청남도 15개 시/군 전수 등록(파일럿과 동일한 Task-11급 검증)

**제외**:
- Wave 3 이후 나머지 사이트(충북/경남/전남/... 등) — 별도 플랜
- I4의 완전한 해결(226개 전부 동시 등록 시의 마이그레이션/배치 전략) — 청킹으로 하루 처리량이 15개로 제한되므로 이번 wave 규모에서는 발생하지 않는다. 사이트 총수가 늘어 청크 자체가 커지는 시점(예: 청크 크기 자체를 올려야 할 때)에 재검토한다.
- 파일럿 5개 사이트의 `addressRaw` 소급 채우기 — 기회가 되면(해당 사이트 HTML에 주소 텍스트가 있으면) 넣지만 이번 플랜의 필수 산출물은 아니다.

## 아키텍처

### 1. 사이트 URL 리서치

226개 목표 중 아직 등록되지 않은 사이트의 문화관광 목록 페이지 URL은 공식 데이터셋이 없으므로 Claude의 웹 검색으로 조사한다. Wave 2(충청남도 15곳)는 권역이 하나이므로 병렬 서브에이전트 없이 이번 세션에서 직접 조사하고, wave 3 이후 권역이 여러 개 겹칠 때부터 권역별로 나눠 병렬 서브에이전트에게 위임한다.

### 2. 사이트별 검증 절차 (파일럿 Task 11과 동일한 전수 검증)

신규 사이트마다 다음을 빠짐없이 수행한다:
1. `robots.txt` 확인 — 목록 페이지 크롤링이 금지되지 않았는지
2. 목록 페이지 raw HTML을 `curl`로 직접 확인
3. 셀렉터(itemSelector/titleSelector/dateSelector/linkSelector, 필요시 imageSelector/venueSelector/addressSelector)를 raw HTML 구조에 맞춰 직접 작성
4. 선언적 파서로 안 되는 구조(캘린더 위젯, JS 렌더링, 비표준 마크업 등)는 파일럿의 tongyeongUtour.ts/jeongseonArirang.ts처럼 custom parser 작성
5. 문화행사 게시판처럼 "축제" 신호가 없는 카테고리는 파일럿의 안동시 사례처럼 제외 판단

각 사이트는 이 5단계를 통과해야 `cityFestivalSites.ts`에 등록된다. 지름길(가벼운 확인 후 배포해서 0건 나오면 그때 재검토)은 쓰지 않는다.

### 3. 일별 청킹

**신규 파일: `worker-backend/src/cityFestivalSchedule.ts`**

```ts
export const CITY_FESTIVAL_CHUNK_SIZE = 15;

export function currentCityFestivalChunkIndex(date: Date, siteCount: number): number {
  const chunkCount = Math.max(1, Math.ceil(siteCount / CITY_FESTIVAL_CHUNK_SIZE));
  const epochDay = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  return epochDay % chunkCount;
}

export function sitesForChunk<T>(sites: T[], chunkIndex: number, chunkSize: number): T[] {
  const start = chunkIndex * chunkSize;
  return sites.slice(start, start + chunkSize);
}
```

- 청크 개수는 `discoverySchedule.ts`의 `DISCOVERY_PROVIDER_CHUNK_COUNT = DISCOVERY_PROVIDER_CHUNKS.length`와 동일한 원리로 `CITY_FESTIVAL_SITES.length`에서 자동 파생된다. wave가 늘어 사이트가 추가돼도 코드 변경 없이 청크 수가 늘어나고, `epochDay % chunkCount`가 어느 사이트가 어느 날 스크랩될지 자동 재배정한다.
- `CITY_FESTIVAL_CHUNK_SIZE = 15`는 시작값이다. 근거 없이 더 큰 값을 단정하지 않고, wave 2(15개 사이트, 정확히 청크 하나)를 실제로 돌려 CPU 사용량을 관찰한 뒤 필요하면 조정한다.
- `worker-backend/src/index.ts`의 `syncCityFestivalsScheduled()`가 `sitesForChunk(CITY_FESTIVAL_SITES, currentCityFestivalChunkIndex(scheduledAt, CITY_FESTIVAL_SITES.length), CITY_FESTIVAL_CHUNK_SIZE)`로 그날의 부분집합을 계산해 `runCityFestivalDiscovery(db, env, sites)`에 넘긴다. `runCityFestivalDiscovery`는 이미 `sites` 파라미터를 옵션으로 받으므로(`cityFestivalDiscovery.ts:25`) 그 파일 자체는 수정하지 않는다.
- **`POST /admin/sync-city-festivals`(관리자 수동 트리거)는 청킹하지 않고 항상 전체 사이트를 실행한다** — `/admin/sync-discovery`가 cron 청킹과 무관하게 전체를 도는 기존 전례를 따른다. 신규 사이트 등록 직후 즉시 전체 재검증할 때 청킹이 걸림돌이 되지 않도록 하기 위함이다.

### 4. I3 — 좌표 폴백 해결

**(a) 파서 레벨 — 주소/장소 텍스트 추출**

`CitySiteConfig.selectors`에 옵션 필드를 추가한다 (`worker-backend/src/cityFestivalParsers/types.ts`):

```ts
selectors?: {
  itemSelector: string;
  titleSelector: string;
  dateSelector: string;
  linkSelector: string;
  imageSelector?: string;
  venueSelector?: string;
  addressSelector?: string;
};
```

`declarativeParser.ts`는 `venueSelector`/`addressSelector`가 있으면 해당 텍스트를 추출해 `venueRaw`/`addressRaw`에 채운다(없으면 지금처럼 `null`). 사이트마다 목록 HTML에 주소/장소 텍스트가 실제로 있는지는 사이트별 검증 절차(2번) 때 판단하는 사이트별 선택 사항이다 — 226개 전부에 일괄 강제하지 않는다. Custom parser 2곳도 같은 기준으로 해당 사이트 검증 시점에 필요하면 갱신한다.

**(b) 리졸버 레벨 — 실제 geocoding 호출**

`backend/src/features/discover/events/eventProviderUtils.ts`의 `KakaoEventCoordinateResolver`를 그대로 재사용한다. 생성자가 지금 요구하는 `AppConfig` 대신, 클래스가 실제로 쓰는 필드 3개만 요구하는 좁은 인터페이스로 바꾼다:

```ts
export interface KakaoResolverConfig {
  KAKAO_REST_API_KEY?: string;
  PARKING_PROVIDER_MODE: "mock" | "real" | "hybrid";
  KAKAO_LOCAL_BASE_URL: string;
}
```

`backend/src/config/env.ts`의 `AppConfig`와 `worker-backend/src/index.ts`의 `Env` 둘 다 이 세 필드를 동일한 타입으로 이미 갖고 있으므로(확인됨), 생성자 파라미터 타입을 `AppConfig` → `KakaoResolverConfig`로 바꾸는 것만으로 backend 기존 호출부 변경 없이 worker-backend에서도 그대로 재사용된다.

`cityFestivalNormalize.ts`의 `resolveCoordinates()`를 다음과 같이 바꾼다:

```ts
async function resolveCoordinates(
  input: { title: string; venueRaw: string | null; addressRaw: string | null },
  config: CitySiteConfig,
  resolver: EventCoordinateResolver | null
): Promise<{ lat: number; lng: number }> {
  const address = input.addressRaw?.trim();
  const venue = input.venueRaw?.trim();
  if ((address || venue) && resolver) {
    const resolved = await resolver.resolve({
      title: input.title,
      venue: venue ?? null,
      address: address ?? null,
      region: config.cityName,
    });
    if (resolved) return { lat: resolved.lat, lng: resolved.lng };
  }
  return { lat: config.fallbackLat, lng: config.fallbackLng };
}
```

`normalizeCandidate()`가 `resolver` 파라미터를 추가로 받아 그대로 전달한다. `runCityFestivalDiscovery()`가 실행당 리졸버 인스턴스를 하나 생성해 각 사이트의 각 후보 정규화에 넘기고, 마지막에 `await resolver.flush()`로 새로 조회된 좌표를 `geocode_cache`에 기록한다. 이 캐시 테이블은 이벤트 파이프라인과 공유되므로, 같은 주소가 이벤트 쪽에서 이미 geocode된 적이 있으면 city-festival 쪽은 API 호출 없이 캐시 히트로 끝난다.

**(c) 설정 — 미스 예산**

`worker-backend/wrangler.toml`에 `CITY_FESTIVAL_GEOCODE_MISS_BUDGET = "30"`을 추가하고, `Env` 타입에 필드를 추가한다. `runCityFestivalDiscovery()`가 리졸버 생성 시 `resolver.setMissBudget(...)`로 이 값을 적용해, 226개 스케일에서 하루 Kakao API 호출량을 통제한다. 이벤트 파이프라인의 `EVENT_GEOCODE_MISS_BUDGET`(현재 10)과는 별도 값이다 — 두 파이프라인이 다른 cron에서 독립적으로 실행되므로 예산도 독립적으로 관리한다.

`config.KAKAO_REST_API_KEY`가 비어 있거나 `PARKING_PROVIDER_MODE`가 `mock`이면 `KakaoEventCoordinateResolver.resolve()`는 항상 `null`을 반환한다(기존 클래스 동작 그대로) — 이 경우 `resolveCoordinates()`는 지금처럼 시청 좌표 폴백으로 안전하게 떨어진다.

## Wave 2: 충청남도 (15개 시/군)

천안시, 공주시, 보령시, 아산시, 서산시, 논산시, 계룡시, 당진시, 금산군, 부여군, 서천군, 청양군, 홍성군, 예산군, 태안군 — 총 15곳. 파일럿 5개 사이트와 지역 겹침이 없고, 개수(15)가 이번에 정한 청크 크기(15)와 정확히 일치해 청크 경계 동작(사이트 수가 청크 크기의 정확한 배수일 때 `chunkCount = 1`이 되는 경우)을 첫 실전 검증 단위로 삼기에 적합하다.

각 사이트는 위 "사이트별 검증 절차"의 5단계를 전부 통과해야 등록된다. 조사 결과 문화관광 목록 페이지가 없거나(예: 별도 축제 페이지가 없이 보도자료로만 안내), robots.txt가 크롤링을 금지하거나, "축제" 신호가 없는 게시판만 있는 시/군은 파일럿의 안동시 사례처럼 제외하고 그 근거를 기록한다 — 15곳 전부가 반드시 등록된다는 보장은 아니다.

## 데이터/설정 변경 요약

**신규 파일**:
- `worker-backend/src/cityFestivalSchedule.ts`
- `worker-backend/tests/cityFestivalSchedule.test.ts`
- (wave 2 검증 결과에 따라) `worker-backend/src/cityFestivalParsers/customParsers/*.ts` 추가 파일 0개 이상

**수정 파일**:
- `worker-backend/src/cityFestivalParsers/types.ts` — `venueSelector`/`addressSelector` 옵션 필드 추가
- `worker-backend/src/cityFestivalParsers/declarativeParser.ts` — 새 셀렉터로 `venueRaw`/`addressRaw` 추출
- `worker-backend/src/cityFestivalNormalize.ts` — `resolveCoordinates()`가 리졸버를 받아 실제 geocoding 호출
- `worker-backend/src/cityFestivalDiscovery.ts` — 리졸버 인스턴스 생성/전달/flush, 청크 적용된 `sites` 인자 사용은 index.ts 쪽에서 처리(이 파일 시그니처는 불변)
- `worker-backend/src/index.ts` — `syncCityFestivalsScheduled()`가 청크 계산 후 sites 전달, `Env`에 `CITY_FESTIVAL_GEOCODE_MISS_BUDGET` 필드 추가
- `worker-backend/src/cityFestivalSites.ts` — wave 2 사이트 등록
- `worker-backend/wrangler.toml` — `CITY_FESTIVAL_GEOCODE_MISS_BUDGET = "30"` 추가
- `backend/src/features/discover/events/eventProviderUtils.ts` — `KakaoEventCoordinateResolver` 생성자 파라미터 타입을 `AppConfig` → 신규 `KakaoResolverConfig`로 좁힘(구조적으로 호환되므로 기존 backend 호출부는 변경 없음)

**D1 마이그레이션**: 없음. `city_festivals` 테이블은 이미 `venue`/`address` 컬럼을 갖고 있고(파일럿에서 생성됨), `geocode_cache`도 이벤트 파이프라인이 이미 만들어 쓰고 있다.

## 테스트 전략

- `cityFestivalSchedule.test.ts`: 다양한 날짜 × 사이트 수 조합에서 `currentCityFestivalChunkIndex()`가 기대한 인덱스를 반환하는지, 사이트 수가 청크 크기의 배수/비배수일 때 경계가 올바른지, `sitesForChunk()`가 올바른 부분집합을 자르는지.
- `cityFestivalNormalize.test.ts`: `resolveCoordinates()`에 mock 리졸버를 주입해 (1) `addressRaw`/`venueRaw`가 모두 없으면 리졸버를 호출하지 않고 폴백, (2) 리졸버가 값을 반환하면 그 좌표 사용, (3) 리졸버가 `null`을 반환하면 폴백하는 3가지 케이스.
- `declarativeParser.test.ts`: `venueSelector`/`addressSelector`가 설정에 있을 때/없을 때 각각 `venueRaw`/`addressRaw`가 올바르게 채워지는지.
- wave 2 등록 후: 파일럿과 동일하게 `pnpm -C worker-backend typecheck`, 관련 vitest 전체 통과, `wrangler deploy --dry-run` 빌드 확인.

## 향후 (스코프 밖)

Wave 3 이후 나머지 ~196개 사이트는 이 문서가 만드는 인프라(청킹, geocoding, 검증 절차)를 그대로 재사용해 권역 단위로 반복한다. 사이트 수가 늘어 `CITY_FESTIVAL_CHUNK_SIZE`를 올려야 하는 시점, 그리고 I4가 실제로 발현되는 시점(현재 5개 배치 → wave 2 이후 최대 15개 배치, `db.batch()` 한도에는 아직 여유가 있다고 판단)은 그때 재평가한다.
