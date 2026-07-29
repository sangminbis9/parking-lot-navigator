# 도시별 축제 스크래퍼 226개 사이트 확장 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5개 사이트 파일럿을 226개 시/군/구로 단계적으로 확장하기 위한 일별 청킹 인프라를 만들고, 좌표가 항상 시청 폴백으로 찍히는 I3 문제를 실제 Kakao geocoding 배선으로 해결한 뒤, 충청남도 15개 시/군을 첫 확장 wave로 등록한다.

**Architecture:** `cityFestivalSchedule.ts`가 `discoverySchedule.ts`의 청크 패턴을 하루 단위로 재사용해 사이트 배열을 날짜별 부분집합으로 나눈다. `declarativeParser.ts`가 새 옵션 셀렉터로 주소/장소 텍스트를 추출하고, `cityFestivalNormalize.ts`가 이벤트 파이프라인의 `KakaoEventCoordinateResolver`(생성자 타입만 좁혀 재사용)를 통해 실제 좌표를 조회한다.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, cheerio, vitest.

## Global Constraints

- 청크 크기는 `CITY_FESTIVAL_CHUNK_SIZE = 15`로 고정한다(설계 문서 근거: 파일럿 규모 기준 시작값, wave 2 실측 후 조정).
- 신규 env var `CITY_FESTIVAL_GEOCODE_MISS_BUDGET`은 기본값 `"30"`이며 `worker-backend/wrangler.toml`의 `[vars]`에 문자열로 추가한다.
- D1 마이그레이션은 이 플랜에서 필요 없다 — `city_festivals`(venue/address 컬럼 포함)와 `geocode_cache`는 이미 존재한다.
- `POST /admin/sync-city-festivals`(관리자 수동 트리거)는 청킹하지 않고 항상 `CITY_FESTIVAL_SITES` 전체를 실행한다. 청킹은 `scheduled()`의 cron 경로에서만 적용한다.
- 파일럿 5개 사이트(`sunchang-sftf`, `pyeongtaek-pccf`, `gyeongsan-gsctf`, `tongyeong-utour`, `jeongseon-arirang`)의 기존 설정은 수정하지 않는다.
- Wave 2 대상 15개 시/군: 천안시, 공주시, 보령시, 아산시, 서산시, 논산시, 계룡시, 당진시, 금산군, 부여군, 서천군, 청양군, 홍성군, 예산군, 태안군. 각 사이트는 robots.txt 확인 → raw HTML curl 확인 → 셀렉터/custom parser 작성이라는 파일럿과 동일한 전수 검증을 통과해야 등록된다. 통과하지 못하면(문화행사 게시판에 축제 신호 없음, 크롤링 금지 등) 사유를 기록하고 제외할 수 있다 — 15곳 전부 등록이 강제 목표가 아니다.
- Kakao geocoding은 `KAKAO_REST_API_KEY`가 없거나 `PARKING_PROVIDER_MODE`가 `"mock"`이면 항상 안전하게 시청 폴백 좌표로 떨어져야 한다(기존 `KakaoEventCoordinateResolver` 동작 그대로).

---

## Task 1: 일별 청킹 함수

**Files:**
- Create: `worker-backend/src/cityFestivalSchedule.ts`
- Test: `worker-backend/tests/cityFestivalSchedule.test.ts`

**Interfaces:**
- Produces: `CITY_FESTIVAL_CHUNK_SIZE: number`, `currentCityFestivalChunkIndex(date: Date, siteCount: number): number`, `sitesForChunk<T>(sites: T[], chunkIndex: number, chunkSize: number): T[]` — Task 6이 이 세 개를 그대로 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/cityFestivalSchedule.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  CITY_FESTIVAL_CHUNK_SIZE,
  currentCityFestivalChunkIndex,
  sitesForChunk,
} from "../src/cityFestivalSchedule.js";

describe("currentCityFestivalChunkIndex", () => {
  it("visits every chunk across enough days when site count exceeds one chunk", () => {
    const siteCount = 20; // chunkCount = ceil(20/15) = 2
    const seen = new Set<number>();
    for (let day = 0; day < 10; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day, 4, 0));
      seen.add(currentCityFestivalChunkIndex(date, siteCount));
    }
    expect(seen).toEqual(new Set([0, 1]));
  });

  it("always returns 0 when site count fits in a single chunk", () => {
    for (let day = 0; day < 5; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day, 4, 0));
      expect(currentCityFestivalChunkIndex(date, 5)).toBe(0);
    }
  });

  it("returns 0 when site count is zero instead of dividing by zero", () => {
    expect(currentCityFestivalChunkIndex(new Date(Date.UTC(2026, 0, 1)), 0)).toBe(0);
  });

  it("rotates by whole days, not by time of day", () => {
    const early = new Date(Date.UTC(2026, 0, 1, 0, 0));
    const late = new Date(Date.UTC(2026, 0, 1, 23, 59));
    expect(currentCityFestivalChunkIndex(early, 20)).toBe(
      currentCityFestivalChunkIndex(late, 20),
    );
  });
});

describe("sitesForChunk", () => {
  it("slices the array into the requested chunk", () => {
    const sites = Array.from({ length: 20 }, (_, i) => `site-${i}`);
    expect(sitesForChunk(sites, 0, CITY_FESTIVAL_CHUNK_SIZE)).toEqual(sites.slice(0, 15));
    expect(sitesForChunk(sites, 1, CITY_FESTIVAL_CHUNK_SIZE)).toEqual(sites.slice(15, 20));
  });

  it("returns an empty array for a chunk index beyond the array length", () => {
    const sites = ["a", "b", "c"];
    expect(sitesForChunk(sites, 5, 15)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `pnpm -C worker-backend test`
Expected: FAIL — `Cannot find module '../src/cityFestivalSchedule.js'`

- [ ] **Step 3: 구현**

`worker-backend/src/cityFestivalSchedule.ts`:

```typescript
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

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `pnpm -C worker-backend test`
Expected: PASS (전체 스위트)

- [ ] **Step 5: Commit**

```bash
git add worker-backend/src/cityFestivalSchedule.ts worker-backend/tests/cityFestivalSchedule.test.ts
git commit -m "Add day-based chunking for city festival scraper sites"
```

---

## Task 2: `KakaoEventCoordinateResolver` 생성자 타입 좁히기

**이 태스크는 순수 타입 리팩터링이다.** 클래스가 실제로 쓰는 필드 3개만 요구하는 인터페이스로 생성자 파라미터 타입을 바꿔서, worker-backend의 `Env` 타입도 backend의 `AppConfig`처럼 구조적으로 이 클래스를 그대로 쓸 수 있게 한다. 동작은 바뀌지 않으므로 기존 테스트가 그대로 통과해야 한다 — 새 실패 테스트를 먼저 쓰는 대신, 기존 테스트가 baseline에서 통과하는지 먼저 확인하고 타입만 바꾼 뒤 다시 통과하는지 확인한다.

**Files:**
- Modify: `backend/src/features/discover/events/eventProviderUtils.ts:1-121`

**Interfaces:**
- Produces: `export interface KakaoResolverConfig { KAKAO_REST_API_KEY?: string; PARKING_PROVIDER_MODE: "mock" | "real" | "hybrid"; KAKAO_LOCAL_BASE_URL: string; }` — Task 5가 worker-backend의 `Env`를 이 타입 자리에 그대로 넘긴다.

- [ ] **Step 1: 기존 테스트가 baseline에서 통과하는지 확인**

Run: `pnpm --filter @parking/backend test`
Expected: PASS (특히 `backend/tests/eventProviderUtils.test.ts`)

- [ ] **Step 2: import와 생성자 타입 변경**

`backend/src/features/discover/events/eventProviderUtils.ts`에서 최상단 import를 바꾼다:

```typescript
// 기존
import type { AppConfig } from "../../../config/env.js";
```

이 줄을 삭제한다 (`AppConfig`는 생성자 파라미터에서만 쓰였고, 아래에서 그 자리를 `KakaoResolverConfig`로 대체하므로 더 이상 필요 없다).

`export class KakaoEventCoordinateResolver` 바로 위에 새 인터페이스를 추가하고, 생성자 파라미터 타입을 바꾼다:

```typescript
// 기존
export class KakaoEventCoordinateResolver implements EventCoordinateResolver {
  private cache = new Map<string, Promise<ResolvedCoordinate>>();
  private pendingWrites = new Map<string, GeocodeStoreEntry>();
  private missBudget: number;
  private missCount = 0;

  constructor(
    private readonly config: AppConfig,
    options: { missBudget?: number } = {},
  ) {
    this.missBudget = options.missBudget ?? Number.POSITIVE_INFINITY;
  }

// 변경 후
export interface KakaoResolverConfig {
  KAKAO_REST_API_KEY?: string;
  PARKING_PROVIDER_MODE: "mock" | "real" | "hybrid";
  KAKAO_LOCAL_BASE_URL: string;
}

export class KakaoEventCoordinateResolver implements EventCoordinateResolver {
  private cache = new Map<string, Promise<ResolvedCoordinate>>();
  private pendingWrites = new Map<string, GeocodeStoreEntry>();
  private missBudget: number;
  private missCount = 0;

  constructor(
    private readonly config: KakaoResolverConfig,
    options: { missBudget?: number } = {},
  ) {
    this.missBudget = options.missBudget ?? Number.POSITIVE_INFINITY;
  }
```

클래스 나머지 부분(`resolve`, `warmup`, `flush`, `fetchCoordinate` 등)은 `this.config`의 필드 3개만 읽으므로 수정하지 않는다.

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @parking/backend exec tsc --noEmit`
Expected: 0 errors — `backend/tests/eventProviderUtils.test.ts`의 `testConfig(): AppConfig`가 `KakaoResolverConfig`의 상위집합이므로 구조적으로 계속 호환된다. `backend/src/features/discover/events/CulturePortalEventProvider.ts:291`의 `new KakaoEventCoordinateResolver(config)` 호출부도 변경 없이 통과해야 한다.

- [ ] **Step 4: 테스트 재실행**

Run: `pnpm --filter @parking/backend test`
Expected: PASS — 동작 변경이 없으므로 모든 기존 테스트가 그대로 통과해야 한다.

- [ ] **Step 5: Commit**

```bash
git add backend/src/features/discover/events/eventProviderUtils.ts
git commit -m "Narrow KakaoEventCoordinateResolver constructor to a minimal config interface"
```

---

## Task 3: 파서 셀렉터 확장 — 주소/장소 텍스트 추출

**Files:**
- Modify: `worker-backend/src/cityFestivalParsers/types.ts`
- Modify: `worker-backend/src/cityFestivalParsers/declarativeParser.ts`
- Modify: `worker-backend/tests/declarativeParser.test.ts`

**Interfaces:**
- Produces: `CitySiteConfig.selectors`에 옵션 필드 `venueSelector?: string`, `addressSelector?: string` 추가. `parseDeclarative()`가 설정되어 있으면 `RawCityFestivalCandidate.venueRaw`/`addressRaw`를 채운다(둘 다 기존처럼 옵션이라 없으면 `null`).

- [ ] **Step 1: 실패하는 테스트 추가**

`worker-backend/tests/declarativeParser.test.ts`의 기존 `describe("parseDeclarative", ...)` 블록 안, 마지막 `it(...)` 다음에 두 케이스를 추가한다:

```typescript
  it("extracts venueRaw and addressRaw when venueSelector/addressSelector are configured", () => {
    const configWithAddress: CitySiteConfig = {
      ...tableConfig,
      selectors: {
        ...tableConfig.selectors!,
        venueSelector: "td.venue",
        addressSelector: "td.address"
      }
    };
    const html = `
      <table><tbody>
        <tr class="row">
          <td class="title"><a href="/detail/1">가을 단풍 축제</a></td>
          <td class="date">2026.10.01 ~ 2026.10.03</td>
          <td class="venue">시민공원</td>
          <td class="address">테스트시 테스트로 1</td>
        </tr>
      </tbody></table>
    `;

    const result = parseDeclarative(html, configWithAddress);

    expect(result[0].venueRaw).toBe("시민공원");
    expect(result[0].addressRaw).toBe("테스트시 테스트로 1");
  });

  it("leaves venueRaw/addressRaw null when venueSelector/addressSelector are not configured", () => {
    const html = `
      <table><tbody>
        <tr class="row">
          <td class="title"><a href="/detail/1">가을 단풍 축제</a></td>
          <td class="date">2026.10.01 ~ 2026.10.03</td>
        </tr>
      </tbody></table>
    `;
    const result = parseDeclarative(html, tableConfig);
    expect(result[0].venueRaw).toBeNull();
    expect(result[0].addressRaw).toBeNull();
  });
```

- [ ] **Step 2: 테스트 실행해서 첫 번째 케이스 실패 확인**

Run: `pnpm -C worker-backend test`
Expected: FAIL — `expect(result[0].venueRaw).toBe("시민공원")`에서 실제값이 `null`.

- [ ] **Step 3: `types.ts`에 셀렉터 필드 추가**

`worker-backend/src/cityFestivalParsers/types.ts`:

```typescript
export interface CitySiteConfig {
  siteId: string;
  cityName: string;
  listUrl: string;
  fallbackLat: number;
  fallbackLng: number;
  robotsCheckedAt: string;
  selectors?: {
    itemSelector: string;
    titleSelector: string;
    dateSelector: string;
    linkSelector: string;
    imageSelector?: string;
    venueSelector?: string;
    addressSelector?: string;
  };
  customParser?: string;
}
```

- [ ] **Step 4: `declarativeParser.ts`에서 추출 로직 추가**

`worker-backend/src/cityFestivalParsers/declarativeParser.ts` 전체를 다음으로 교체한다:

```typescript
import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./types.js";

export function parseDeclarative(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  if (!config.selectors) return [];
  const {
    itemSelector,
    titleSelector,
    dateSelector,
    linkSelector,
    imageSelector,
    venueSelector,
    addressSelector
  } = config.selectors;
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(itemSelector).each((_index, element) => {
    const item = $(element);
    const title = item.find(titleSelector).first().text().trim() || null;
    const dateText = item.find(dateSelector).first().text().trim() || null;
    const linkHref = item.find(linkSelector).first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref, config.listUrl);
    const imageSrc = imageSelector
      ? (item.find(imageSelector).first().attr("src") ?? null)
      : null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);
    const venueRaw = venueSelector
      ? item.find(venueSelector).first().text().trim() || null
      : null;
    const addressRaw = addressSelector
      ? item.find(addressSelector).first().text().trim() || null
      : null;

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw,
      addressRaw,
      detailUrl,
      imageUrl
    });
  });

  return results;
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `pnpm -C worker-backend test`
Expected: PASS (전체 스위트, `declarativeParser.test.ts` 포함 — 기존 3개 케이스도 셀렉터 미설정 시 `venueRaw`/`addressRaw`가 여전히 `null`이므로 그대로 통과해야 한다)

- [ ] **Step 6: typecheck**

Run: `pnpm -C worker-backend typecheck`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add worker-backend/src/cityFestivalParsers/types.ts worker-backend/src/cityFestivalParsers/declarativeParser.ts worker-backend/tests/declarativeParser.test.ts
git commit -m "Add optional venue/address selectors to the declarative city festival parser"
```

---

## Task 4: `cityFestivalNormalize.ts` — 리졸버로 좌표 조회

**이 태스크가 I3의 핵심 수정이다.** 지금까지 `resolveCoordinates()`는 D1 geocode 캐시를 직접 읽기만 했다(쓰기 없음 → 항상 미스 → 항상 폴백). 이 태스크부터는 실제 geocoding을 수행하는 리졸버(`EventCoordinateResolver` 인터페이스 — Task 2에서 타입만 좁혔을 뿐 이 인터페이스 자체는 이미 존재)를 옵션으로 받아 호출한다. 리졸버 인스턴스 생성은 Task 5(`cityFestivalDiscovery.ts`)에서 한다 — 이 태스크는 "리졸버가 주어지면 쓴다"는 순수 로직만 담당한다.

**Files:**
- Modify: `worker-backend/src/cityFestivalNormalize.ts`
- Modify: `worker-backend/tests/cityFestivalNormalize.test.ts`

**Interfaces:**
- Consumes: `EventCoordinateResolver` 인터페이스 (`backend/src/features/discover/events/eventProviderUtils.ts` — `resolve(input: ResolverInput): Promise<{lat,lng,address,venue}|null>`, 이미 존재, 변경 없음)
- Produces: `normalizeCandidate(candidate: RawCityFestivalCandidate, config: CitySiteConfig, resolver?: EventCoordinateResolver | null): Promise<NormalizedCityFestival | null>` — 세 번째 파라미터가 옵션(기본 `null`)으로 추가됨. Task 5가 실제 `KakaoEventCoordinateResolver` 인스턴스를 여기에 넘긴다.

- [ ] **Step 1: 테스트 파일을 리졸버 기반으로 교체 (실패하는 상태로)**

`worker-backend/tests/cityFestivalNormalize.test.ts` 전체를 다음으로 교체한다:

```typescript
import { describe, expect, it } from "vitest";
import type { EventCoordinateResolver } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { normalizeCandidate, parseCityDateRange } from "../src/cityFestivalNormalize.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../src/cityFestivalParsers/types.js";

const config: CitySiteConfig = {
  siteId: "test-city",
  cityName: "테스트시",
  listUrl: "https://example.com/festivals",
  fallbackLat: 37.5,
  fallbackLng: 127.0,
  robotsCheckedAt: "2026-07-28"
};

describe("parseCityDateRange", () => {
  it("extracts a start/end pair from a single combined range string", () => {
    expect(parseCityDateRange("2026.10.01 ~ 2026.10.03", "2026.10.01 ~ 2026.10.03")).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-03"
    });
  });

  it("falls back to the same date for both ends when only one date is present", () => {
    expect(parseCityDateRange("2026-11-05", null)).toEqual({
      startDate: "2026-11-05",
      endDate: "2026-11-05"
    });
  });

  it("returns null when no recognizable date is present", () => {
    expect(parseCityDateRange("상시", null)).toBeNull();
  });
});

describe("normalizeCandidate", () => {
  const baseCandidate: RawCityFestivalCandidate = {
    title: "가을 단풍 축제",
    startDateRaw: "2026.10.01 ~ 2026.10.03",
    endDateRaw: "2026.10.01 ~ 2026.10.03",
    venueRaw: null,
    addressRaw: null,
    detailUrl: "https://example.com/detail/1",
    imageUrl: "https://example.com/img/1.jpg"
  };

  it("returns null when title is missing", async () => {
    const result = await normalizeCandidate({ ...baseCandidate, title: null }, config);
    expect(result).toBeNull();
  });

  it("returns null when no date can be parsed", async () => {
    const result = await normalizeCandidate(
      { ...baseCandidate, startDateRaw: "상시", endDateRaw: "상시" },
      config
    );
    expect(result).toBeNull();
  });

  it("falls back to config coordinates when there is no address or venue", async () => {
    const result = await normalizeCandidate(baseCandidate, config);
    expect(result).toEqual({
      siteId: "test-city",
      sourceUrl: "https://example.com/detail/1",
      hasDetailUrl: true,
      title: "가을 단풍 축제",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      venue: null,
      address: null,
      lat: 37.5,
      lng: 127.0,
      imageUrl: "https://example.com/img/1.jpg"
    });
  });

  it("falls back to config coordinates when there is an address but no resolver is given", async () => {
    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "테스트시 테스트로 1" },
      config
    );
    expect(result?.lat).toBe(37.5);
    expect(result?.lng).toBe(127.0);
  });

  it("uses the resolver's coordinates when an address is present and the resolver finds a match", async () => {
    const fakeResolver: EventCoordinateResolver = {
      async resolve(input) {
        expect(input).toEqual({
          title: "가을 단풍 축제",
          venue: null,
          address: "테스트시 테스트로 1",
          region: "테스트시"
        });
        return { lat: 36.1, lng: 128.4, address: input.address ?? null, venue: null };
      }
    };

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "테스트시 테스트로 1" },
      config,
      fakeResolver
    );
    expect(result?.lat).toBe(36.1);
    expect(result?.lng).toBe(128.4);
  });

  it("falls back to config coordinates when the resolver cannot find a match", async () => {
    const fakeResolver: EventCoordinateResolver = {
      async resolve() {
        return null;
      }
    };

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "미등록 주소" },
      config,
      fakeResolver
    );
    expect(result?.lat).toBe(37.5);
    expect(result?.lng).toBe(127.0);
  });

  it("marks hasDetailUrl false and falls back sourceUrl to the site's listUrl when detailUrl is missing", async () => {
    const result = await normalizeCandidate({ ...baseCandidate, detailUrl: null }, config);
    expect(result?.hasDetailUrl).toBe(false);
    expect(result?.sourceUrl).toBe("https://example.com/festivals");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `pnpm -C worker-backend test`
Expected: FAIL — "uses the resolver's coordinates..." 케이스가 `result?.lat`이 `37.5`(폴백)로 나와 `36.1`과 불일치. 나머지 테스트도 `getGeocodeStore`/`setGeocodeStore` import가 삭제됐으므로 컴파일 자체가 실패할 수 있다(정상 — 다음 스텝에서 구현을 맞춘다).

- [ ] **Step 3: `cityFestivalNormalize.ts` 구현**

`worker-backend/src/cityFestivalNormalize.ts` 전체를 다음으로 교체한다:

```typescript
import type { EventCoordinateResolver } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./cityFestivalParsers/types.js";

export interface NormalizedCityFestival {
  siteId: string;
  sourceUrl: string;
  hasDetailUrl: boolean;
  title: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  address: string | null;
  lat: number;
  lng: number;
  imageUrl: string | null;
}

const DATE_PATTERNS = [
  /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g,
  /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
];

function extractDates(raw: string): string[] {
  for (const pattern of DATE_PATTERNS) {
    const regex = new RegExp(pattern.source, "g");
    const dates: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      const [, year, month, day] = match;
      dates.push(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    }
    if (dates.length > 0) return dates;
  }
  return [];
}

export function parseCityDateRange(
  startRaw: string | null,
  endRaw: string | null
): { startDate: string; endDate: string } | null {
  const startCandidates = startRaw ? extractDates(startRaw) : [];
  if (startCandidates.length === 0) return null;

  const startDate = startCandidates[0];
  if (startCandidates.length >= 2) {
    const endDate = startCandidates[1];
    return { startDate, endDate: endDate >= startDate ? endDate : startDate };
  }

  const endCandidates = endRaw && endRaw !== startRaw ? extractDates(endRaw) : [];
  const endDate = endCandidates[0] ?? startDate;
  return { startDate, endDate: endDate >= startDate ? endDate : startDate };
}

async function resolveCoordinates(
  input: { title: string; venueRaw: string | null; addressRaw: string | null },
  config: CitySiteConfig,
  resolver: EventCoordinateResolver | null
): Promise<{ lat: number; lng: number }> {
  const address = input.addressRaw?.trim();
  const venue = input.venueRaw?.trim();
  if ((!address && !venue) || !resolver) {
    return { lat: config.fallbackLat, lng: config.fallbackLng };
  }

  try {
    const resolved = await resolver.resolve({
      title: input.title,
      venue: venue ?? null,
      address: address ?? null,
      region: config.cityName
    });
    if (resolved) return { lat: resolved.lat, lng: resolved.lng };
  } catch {
    // best-effort: geocoding 실패는 fallback 좌표로 무시한다
  }
  return { lat: config.fallbackLat, lng: config.fallbackLng };
}

export async function normalizeCandidate(
  candidate: RawCityFestivalCandidate,
  config: CitySiteConfig,
  resolver: EventCoordinateResolver | null = null
): Promise<NormalizedCityFestival | null> {
  const title = candidate.title?.trim();
  if (!title) return null;

  const dateRange = parseCityDateRange(candidate.startDateRaw, candidate.endDateRaw);
  if (!dateRange) return null;

  const { lat, lng } = await resolveCoordinates(
    { title, venueRaw: candidate.venueRaw, addressRaw: candidate.addressRaw },
    config,
    resolver
  );

  const detailUrl = candidate.detailUrl?.trim() || null;

  return {
    siteId: config.siteId,
    sourceUrl: detailUrl ?? config.listUrl,
    hasDetailUrl: detailUrl !== null,
    title,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    venue: candidate.venueRaw?.trim() || null,
    address: candidate.addressRaw?.trim() || null,
    lat,
    lng,
    imageUrl: candidate.imageUrl?.trim() || null
  };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `pnpm -C worker-backend test`
Expected: PASS (전체 스위트)

- [ ] **Step 5: typecheck**

Run: `pnpm -C worker-backend typecheck`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add worker-backend/src/cityFestivalNormalize.ts worker-backend/tests/cityFestivalNormalize.test.ts
git commit -m "Wire city festival coordinate resolution through EventCoordinateResolver"
```

---

## Task 5: `cityFestivalDiscovery.ts` — 리졸버 생성/전달/flush

**Files:**
- Modify: `worker-backend/src/cityFestivalDiscovery.ts`
- Modify: `worker-backend/src/index.ts:60` 근처 (`Env` 타입에 필드 1개 추가)
- Modify: `worker-backend/tests/cityFestivalDiscovery.test.ts`

**Interfaces:**
- Consumes: `normalizeCandidate(candidate, config, resolver?)` (Task 4), `KakaoEventCoordinateResolver`/`KakaoResolverConfig` (Task 2)
- Produces: `runCityFestivalDiscovery(db, env, sites?)` — 시그니처는 그대로지만, `env`에 `KAKAO_REST_API_KEY`가 있으면 실제 geocoding을 수행한다. Task 6이 `env`와 청크로 나눈 `sites`를 그대로 넘긴다.

- [ ] **Step 1: `index.ts`의 `Env` 타입에 필드 추가**

`worker-backend/src/index.ts`에서 `CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE?: string;` 줄(현재 60번째 줄) 바로 아래에 추가한다:

```typescript
  CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE?: string;
  CITY_FESTIVAL_GEOCODE_MISS_BUDGET?: string;
```

- [ ] **Step 2: 테스트 파일 교체 (실패하는 상태로)**

`worker-backend/tests/cityFestivalDiscovery.test.ts` 전체를 다음으로 교체한다:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCityFestivalDiscovery } from "../src/cityFestivalDiscovery.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";
import type { Env } from "../src/index.js";

function fakeDb(): {
  db: D1Database;
  batch: ReturnType<typeof vi.fn>;
  prepareCalls: unknown[][];
} {
  const batch = vi.fn(async () => []);
  const prepareCalls: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        prepareCalls.push(args);
        return {};
      }
    }),
    batch
  } as unknown as D1Database;
  return { db, batch, prepareCalls };
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides } as Env;
}

const tableSite: CitySiteConfig = {
  siteId: "site-a",
  cityName: "테스트시",
  listUrl: "https://example.com/festivals",
  fallbackLat: 37.5,
  fallbackLng: 127.0,
  robotsCheckedAt: "2026-07-28",
  selectors: {
    itemSelector: "tr.row",
    titleSelector: "td.title a",
    dateSelector: "td.date",
    linkSelector: "td.title a"
  }
};

const VALID_HTML = `
  <table><tbody>
    <tr class="row">
      <td class="title"><a href="/detail/1">가짜 축제</a></td>
      <td class="date">2026.09.01 ~ 2026.09.03</td>
    </tr>
  </tbody></table>
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCityFestivalDiscovery", () => {
  it("processes a site, scores its candidate above threshold, and upserts it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(VALID_HTML, { status: 200 })
    );
    const { db, batch } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite]);

    expect(result.processed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.failedSites).toEqual([]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(1);
  });

  it("records a failing site in failedSites and still processes the remaining sites", async () => {
    const otherSite: CitySiteConfig = { ...tableSite, siteId: "site-b", listUrl: "https://example.org/festivals" };
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(VALID_HTML, { status: 200 }));
    const { db, batch } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite, otherSite]);

    expect(result.failedSites).toEqual(["site-a"]);
    expect(result.published).toBe(1);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("treats a non-ok HTTP response as a site failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const { db } = fakeDb();

    const result = await runCityFestivalDiscovery(db, fakeEnv(), [tableSite]);

    expect(result.failedSites).toEqual(["site-a"]);
    expect(result.published).toBe(0);
  });

  it("does not call the Kakao geocoding API when candidates have no address or venue", async () => {
    const fetchMock = vi.fn(async () => new Response(VALID_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();
    const envWithKey = fakeEnv({
      KAKAO_REST_API_KEY: "test-key",
      PARKING_PROVIDER_MODE: "real",
      KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com"
    });

    await runCityFestivalDiscovery(db, envWithKey, [tableSite]);

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.every((url) => !url.includes("dapi.kakao.com"))).toBe(true);
  });

  it("uses the resolved Kakao coordinates when a candidate has an address and the API finds a match", async () => {
    const siteWithAddress: CitySiteConfig = {
      ...tableSite,
      siteId: "site-with-address",
      selectors: { ...tableSite.selectors!, addressSelector: "td.address" }
    };
    const htmlWithAddress = `
      <table><tbody>
        <tr class="row">
          <td class="title"><a href="/detail/1">가짜 축제</a></td>
          <td class="date">2026.09.01 ~ 2026.09.03</td>
          <td class="address">테스트시 테스트로 1</td>
        </tr>
      </tbody></table>
    `;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const urlString = String(url);
      if (urlString.includes("dapi.kakao.com")) {
        return Response.json({
          documents: [
            {
              place_name: "테스트 광장",
              road_address_name: "테스트시 테스트로 1",
              x: "128.4",
              y: "36.1"
            }
          ]
        });
      }
      return new Response(htmlWithAddress, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db, prepareCalls } = fakeDb();
    const envWithKey = fakeEnv({
      KAKAO_REST_API_KEY: "test-key",
      PARKING_PROVIDER_MODE: "real",
      KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com"
    });

    const result = await runCityFestivalDiscovery(db, envWithKey, [siteWithAddress]);

    expect(result.published).toBe(1);
    expect(prepareCalls[0][8]).toBe(36.1);
    expect(prepareCalls[0][9]).toBe(128.4);
  });
});
```

- [ ] **Step 3: 테스트 실행해서 마지막 두 케이스 실패 확인**

Run: `pnpm -C worker-backend test`
Expected: FAIL — 마지막 케이스에서 `prepareCalls[0][8]`이 `36.1`이 아니라 `37.5`(폴백)로 나옴. 처음 세 케이스는 `env`에 `KAKAO_REST_API_KEY`가 없으므로 이미 통과해야 정상이다(리졸버가 안전하게 no-op).

- [ ] **Step 4: `cityFestivalDiscovery.ts` 구현**

`worker-backend/src/cityFestivalDiscovery.ts`에서 import와 상수, `runCityFestivalDiscovery` 함수 본문을 바꾼다:

```typescript
// 기존
import { fetchWithTimeout, setGeocodeStore } from "../../backend/src/features/discover/events/eventProviderUtils.js";
```

를 다음으로 바꾼다:

```typescript
import {
  fetchWithTimeout,
  setGeocodeStore,
  KakaoEventCoordinateResolver
} from "../../backend/src/features/discover/events/eventProviderUtils.js";
```

`const DEFAULT_AUTO_PUBLISH_MIN_SCORE = 0.7;` 바로 아래에 상수를 추가한다:

```typescript
const DEFAULT_GEOCODE_MISS_BUDGET = 30;
```

`runCityFestivalDiscovery` 함수 본문을 다음으로 교체한다(시그니처는 그대로):

```typescript
export async function runCityFestivalDiscovery(
  db: D1Database,
  env: Env,
  sites: CitySiteConfig[] = CITY_FESTIVAL_SITES
): Promise<CityFestivalDiscoveryResult> {
  setGeocodeStore(createD1GeocodeStore(db));

  const rawThresholdInput = env.CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE?.trim();
  const rawThreshold = rawThresholdInput ? Number(rawThresholdInput) : DEFAULT_AUTO_PUBLISH_MIN_SCORE;
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : DEFAULT_AUTO_PUBLISH_MIN_SCORE;

  const rawMissBudgetInput = env.CITY_FESTIVAL_GEOCODE_MISS_BUDGET?.trim();
  const rawMissBudget = rawMissBudgetInput ? Number(rawMissBudgetInput) : DEFAULT_GEOCODE_MISS_BUDGET;
  const missBudget = Number.isFinite(rawMissBudget) ? rawMissBudget : DEFAULT_GEOCODE_MISS_BUDGET;
  const resolver = new KakaoEventCoordinateResolver(env, { missBudget });

  let processed = 0;
  let published = 0;
  const failedSites: string[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const site of sites) {
    try {
      const candidates = await discoverSite(site);
      processed += candidates.length;
      await resolver.warmup(
        candidates
          .filter((c) => c.addressRaw || c.venueRaw)
          .map((c) => ({
            title: c.title ?? "",
            venue: c.venueRaw,
            address: c.addressRaw,
            region: site.cityName
          }))
      );
      for (const candidate of candidates) {
        const normalized = await normalizeCandidate(candidate, site, resolver);
        if (!normalized) continue;
        const score = scoreCandidate(normalized);
        if (score < threshold) continue;
        statements.push(buildUpsertStatement(db, normalized, score));
        published += 1;
      }
    } catch (error) {
      console.error(`city festival discovery failed for site=${site.siteId}`, error);
      failedSites.push(site.siteId);
    }
    await delay(CITY_FESTIVAL_INTER_SITE_DELAY_MS);
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
  await resolver.flush();

  return { processed, published, failedSites };
}
```

(`discoverSite`, `buildUpsertStatement`, `buildCityFestivalId`, `djb2`, `delay` 함수는 변경하지 않는다.)

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `pnpm -C worker-backend test`
Expected: PASS (전체 스위트)

- [ ] **Step 6: typecheck**

Run: `pnpm -C worker-backend typecheck`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add worker-backend/src/index.ts worker-backend/src/cityFestivalDiscovery.ts worker-backend/tests/cityFestivalDiscovery.test.ts
git commit -m "Resolve city festival coordinates through Kakao geocoding with a per-run miss budget"
```

---

## Task 6: `index.ts` cron 배선 — 청크 적용 + 미스 예산 설정값

**Files:**
- Modify: `worker-backend/src/index.ts`
- Modify: `worker-backend/wrangler.toml`

**Interfaces:**
- Consumes: `currentCityFestivalChunkIndex`, `sitesForChunk`, `CITY_FESTIVAL_CHUNK_SIZE` (Task 1), `runCityFestivalDiscovery` (기존, Task 5에서 내부 동작만 바뀜)

- [ ] **Step 1: `wrangler.toml`에 미스 예산 변수 추가**

`worker-backend/wrangler.toml`의 `EVENT_GEOCODE_MISS_BUDGET = "10"` 줄(현재 42번째 줄) 바로 아래에 추가한다:

```toml
CITY_FESTIVAL_GEOCODE_MISS_BUDGET = "30"
```

- [ ] **Step 2: `index.ts`에 import 추가**

`import { runCityFestivalDiscovery } from "./cityFestivalDiscovery.js";` 줄 바로 아래에 두 줄을 추가한다:

```typescript
import { CITY_FESTIVAL_SITES } from "./cityFestivalSites.js";
import {
  currentCityFestivalChunkIndex,
  sitesForChunk,
  CITY_FESTIVAL_CHUNK_SIZE
} from "./cityFestivalSchedule.js";
```

- [ ] **Step 3: `syncCityFestivalsScheduled` 함수를 청크를 받도록 수정**

기존:

```typescript
async function syncCityFestivalsScheduled(env: Env): Promise<void> {
  try {
    const result = await runCityFestivalDiscovery(env.DB!, env);
    if (result.failedSites.length > 0) {
      console.warn(`city festival discovery failedSites=${result.failedSites.join(",")}`);
    }
  } catch (error) {
    console.error("city festival discovery sync failed", error);
    await notifyOpsFailure(env, "city festival discovery sync", error);
  }
}
```

변경 후:

```typescript
async function syncCityFestivalsScheduled(env: Env, scheduledAt: Date): Promise<void> {
  try {
    const chunkIndex = currentCityFestivalChunkIndex(scheduledAt, CITY_FESTIVAL_SITES.length);
    const sites = sitesForChunk(CITY_FESTIVAL_SITES, chunkIndex, CITY_FESTIVAL_CHUNK_SIZE);
    const result = await runCityFestivalDiscovery(env.DB!, env, sites);
    if (result.failedSites.length > 0) {
      console.warn(`city festival discovery failedSites=${result.failedSites.join(",")}`);
    }
  } catch (error) {
    console.error("city festival discovery sync failed", error);
    await notifyOpsFailure(env, "city festival discovery sync", error);
  }
}
```

- [ ] **Step 4: 호출부에 `scheduledAt` 전달**

`scheduled()` 안의 `"15 * * * *"` 분기에서:

```typescript
      if (scheduledAt.getUTCHours() === 4) {
        ctx.waitUntil(syncCityFestivalsScheduled(env));
      }
```

를 다음으로 바꾼다:

```typescript
      if (scheduledAt.getUTCHours() === 4) {
        ctx.waitUntil(syncCityFestivalsScheduled(env, scheduledAt));
      }
```

- [ ] **Step 5: typecheck**

Run: `pnpm -C worker-backend typecheck`
Expected: 0 errors

- [ ] **Step 6: 기존 테스트 스위트 실행**

Run: `pnpm -C worker-backend test`
Expected: PASS (전체 스위트 — 이 태스크는 `scheduled()` 내부의 비export 함수만 바꾸므로 새 단위 테스트는 추가하지 않는다. 청크 계산 로직 자체는 Task 1에서 이미 단위 테스트로 검증됨. 실제 동작 확인은 Task 7의 로컬/원격 스모크 테스트에서 한다.)

- [ ] **Step 7: Commit**

```bash
git add worker-backend/src/index.ts worker-backend/wrangler.toml
git commit -m "Apply day-based chunking to the scheduled city festival discovery cron"
```

---

## Task 7: Wave 2 — 충청남도 15개 시/군 등록 (수동 검증 필요)

**이 태스크는 이전 태스크들과 성격이 다르다.** Task 1~6은 실제 사이트 데이터를 다루지 않고 인프라만 만들었다. 이 태스크는 파일럿 Task 11과 동일하게, 실제 사이트 HTML을 직접 열어보고 정확한 셀렉터를 확인한 뒤 등록하는 데이터 입력 작업이다. 이 계획을 쓰는 시점에는 각 사이트의 raw HTML을 열람하지 않았으므로 셀렉터 값을 지금 확정할 수 없다 — 여기서 추측해서 채우면 조용한 오류가 난다.

**Files:**
- Modify: `worker-backend/src/cityFestivalSites.ts` (사이트당 한 항목씩 추가, 기존 5개 파일럿 항목은 건드리지 않음)
- Modify (필요한 사이트만): `worker-backend/src/cityFestivalParsers/customParsers/index.ts` + 사이트별 custom parser 파일(`worker-backend/src/cityFestivalParsers/customParsers/<siteId>.ts`)

- [ ] **Step 1: 15개 시/군 문화관광 사이트 URL 조사**

대상: 천안시, 공주시, 보령시, 아산시, 서산시, 논산시, 계룡시, 당진시, 금산군, 부여군, 서천군, 청양군, 홍성군, 예산군, 태안군. 각 시/군의 공식 문화관광 포털 또는 축제 전용 페이지(관광재단이 별도로 있으면 그쪽 우선, 파일럿의 순창/평택/경산처럼)를 웹 검색으로 찾는다. 축제 목록 게시판/페이지 URL을 확정한다.

- [ ] **Step 2: 각 사이트마다 robots.txt 확인**

`curl https://<사이트>/robots.txt`로 목록 페이지 경로가 `Disallow`에 걸리지 않는지 확인한다. 걸리면 그 사이트는 제외하고 사유를 기록한다.

- [ ] **Step 3: 각 사이트마다 raw HTML을 직접 열어 구조 확인**

`curl -A "Mozilla/5.0 ParkingLotNavigator/1.0" <목록 URL>`로 실제 HTML을 받아 목록 아이템의 반복 구조를 확인한다. `selectors`로 표현되지 않는 사이트는 `customParsers/<siteId>.ts`에 전용 파서를 작성하고 `CUSTOM_PARSERS`에 등록한다(파일럿의 `tongyeongUtour.ts`/`jeongseonArirang.ts` 참고). "문화행사" 게시판처럼 축제 전용 카테고리 신호가 없는 사이트는 파일럿의 안동시 사례처럼 제외 판단한다.

같은 HTML에서 주소나 장소명이 텍스트로 노출되어 있으면(예: 목록 아이템 안에 "장소: OO공원" 같은 줄), Task 3에서 추가한 `venueSelector`/`addressSelector`도 함께 확인해 설정에 채운다 — 없으면 생략해도 된다(그 사이트는 계속 시청 좌표로 폴백된다).

- [ ] **Step 4: 사이트 등록**

`cityFestivalSites.ts`의 `CITY_FESTIVAL_SITES` 배열 끝에 항목을 추가한다. `fallbackLat`/`fallbackLng`는 해당 시청/군청 좌표를 쓴다. `robotsCheckedAt`에는 Step 2를 확인한 날짜(YYYY-MM-DD)를 적는다.

예시 (표 기반 사이트에 주소 셀렉터까지 확인됐다고 가정 — 실제 값은 Step 3에서 확인한 값으로 대체):

```typescript
  {
    siteId: "example-chungnam-city",
    cityName: "예시시",
    listUrl: "https://example-chungnam-city.go.kr/tour/festival/list.do",
    fallbackLat: 36.8,
    fallbackLng: 127.1,
    robotsCheckedAt: "2026-07-29",
    selectors: {
      itemSelector: "실제 확인한 셀렉터",
      titleSelector: "실제 확인한 셀렉터",
      dateSelector: "실제 확인한 셀렉터",
      linkSelector: "실제 확인한 셀렉터",
      addressSelector: "실제 확인한 셀렉터 (있으면)"
    }
  }
```

- [ ] **Step 5: 사이트마다 typecheck + 로컬 스모크 확인**

Run: `pnpm -C worker-backend typecheck`

로컬 `wrangler dev` 기동 후:

```bash
curl -X POST -H "Authorization: Bearer <로컬 SYNC_ADMIN_TOKEN>" "http://localhost:8787/admin/sync-city-festivals"
```

Expected: `processed`가 (파일럿 5곳 + 이번에 등록한 사이트 수)만큼 0보다 크게 나오고, `failedSites`가 비어있거나 실제 접속 실패한 사이트만 나열됨. `published`가 늘지 않으면 셀렉터가 실제로는 아무것도 못 찾고 있다는 뜻이므로 Step 3부터 다시 확인한다.

- [ ] **Step 6: 원격 배포**

```bash
pnpm -C worker-backend deploy
```

D1 마이그레이션은 필요 없다(이 플랜에서 스키마 변경 없음).

- [ ] **Step 7: 배포 후 원격 admin route로 스모크 테스트 + geocoding 검증**

```bash
curl -X POST -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" "https://parking-lot-navigator-api.parkingnav.workers.dev/admin/sync-city-festivals"
```

Expected: `published`가 파일럿 배포 때보다 늘어남. `/api/festivals?lat=...&lng=...&radiusMeters=...`로 등록한 충남 시/군 근처를 조회해 `source: "city-scraped"` 항목이 섞여 나오는지 확인한다.

Step 3에서 `addressSelector`를 채운 사이트가 하나 이상 있으면, D1에서 직접 확인한다:

```bash
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --command "SELECT site_id, title, lat, lng, address FROM city_festivals WHERE site_id = '<addressSelector를 채운 siteId>' LIMIT 5"
```

Expected: 해당 사이트의 `lat`/`lng`가 그 사이트의 `fallbackLat`/`fallbackLng`와 다른 행이 최소 하나 있어야 한다(= 실제 geocoding이 동작했다는 증거). 전부 폴백 좌표와 동일하면, 해당 주소가 Kakao Local Search에서 검색되지 않았거나(주소 텍스트 품질 문제) `CITY_FESTIVAL_GEOCODE_MISS_BUDGET`을 소진했을 수 있다 — 원인을 확인하고 필요하면 주소 텍스트 정제 로직을 보완한다.

- [ ] **Step 8: Commit**

```bash
git add worker-backend/src/cityFestivalSites.ts worker-backend/src/cityFestivalParsers/customParsers/
git commit -m "Register Chungnam wave 2 city festival site configs with verified selectors"
```

---

## Self-Review 메모

- **Spec coverage:** 설계 문서(`docs/superpowers/specs/2026-07-29-city-festival-226-expansion-design.md`)의 4개 아키텍처 컴포넌트 — 청킹(Task 1, 6), 리졸버 재사용을 위한 타입 좁히기(Task 2), 파서 셀렉터 확장(Task 3), 리졸버 배선(Task 4, 5) — 전부 매핑됨. Wave 2(충청남도 15개 시/군, Task 7)도 스펙의 사이트 목록·검증 절차와 동일하게 반영. "스코프 밖" 항목(wave 3 이후, 파일럿 5곳 소급 주소 채우기, I4 완전 해결)은 이 계획에 포함하지 않음.
- **Placeholder scan:** 모든 코드 블록은 완전한 구현이다. Task 7만 셀렉터 실값을 비워뒀는데, 이는 파일럿 Task 11과 동일한 이유로 raw HTML 열람이 선행돼야 하는 데이터 입력 작업이라 의도적으로 미룬 것이다(추측 방지, CLAUDE.md "정말 불확실하면 추측하지 말고 보류한다" 원칙).
- **Type consistency:** `normalizeCandidate`의 세 번째 파라미터명(`resolver`)과 타입(`EventCoordinateResolver | null`)이 Task 4(정의)와 Task 5(호출)에서 동일하다. `KakaoResolverConfig`(Task 2)의 필드 3개(`KAKAO_REST_API_KEY?`, `PARKING_PROVIDER_MODE`, `KAKAO_LOCAL_BASE_URL`)가 worker `Env`(Task 5에서 그대로 넘김)의 동일 필드와 이름·타입이 일치함을 사전에 grep으로 확인했다. `currentCityFestivalChunkIndex`/`sitesForChunk`/`CITY_FESTIVAL_CHUNK_SIZE`(Task 1)를 Task 6이 가져다 쓰는 이름이 정확히 일치한다.
