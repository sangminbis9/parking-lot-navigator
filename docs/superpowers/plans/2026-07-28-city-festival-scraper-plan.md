# 시/군/구 사이트 축제 크롤러 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공공 API에 없는 소규모 지역 축제를 채우기 위해, 시/군/구 문화관광 홈페이지를 크롤링해 D1에 적재하고 기존 `festivalService` 파이프라인에 얇은 provider로 올리는 배치 시스템을 만든다. 이번 계획은 15~20곳 파일럿까지의 프레임워크 구축을 대상으로 한다.

**Architecture:** 새 cron이 `CITY_FESTIVAL_SITES` 설정을 순회하며 사이트별 HTML을 fetch → declarative(cheerio) 또는 custom parser로 원시 후보 추출 → 날짜/좌표/이미지 정규화 → 신뢰 점수 계산 → 임계값 통과 항목만 D1 `city_festivals`에 upsert한다. 별도 얇은 `CityScrapedFestivalProvider`가 이 테이블을 읽기만 하며 `createFestivalService()`의 `extraProviders`로 주입되어, 기존 discovery-cache cron/dedup/서빙 경로(`/api/festivals`, `/api/map/items`)에 새 코드 변경 없이 올라탄다.

**Tech Stack:** Cloudflare Workers (worker-backend), D1, cheerio(HTML 파싱, 신규 dependency), vitest(worker-backend에 신규 도입), 기존 `FestivalProvider` 인터페이스.

## Global Constraints

- 크롤링은 공개 페이지만 best-effort로 읽는다. 우회 헤더, 로그인 세션, 내부 API 역호출을 추가하지 않는다.
- 이미지는 원본 URL 문자열만 저장한다. 다운로드, 재호스팅, 리사이즈를 하지 않는다.
- 사이트 하나의 fetch/parse 실패가 전체 배치 실행을 중단시키지 않는다 (`failedSites`에 기록하고 계속).
- D1 스키마 변경은 반드시 새 migration으로 추가한다. 기존 migration은 수정하지 않는다. 다음 migration 번호는 `0015`다 (최신 기존 파일: `0014_local_event_short_description.sql`).
- 신뢰 점수 임계값 미만인 항목은 D1에 쓰지 않는다 (자동 게시, 별도 승인 큐 없음). 임계값 기본값은 `0.7`, env var `CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE`로 오버라이드 가능.
- robots.txt는 사이트를 config에 등록하는 시점에 사람이 확인하고 `CitySiteConfig.robotsCheckedAt`에 확인 날짜를 남긴다. 런타임 자동 검사는 하지 않는다.
- `city_festivals`에서 읽는 D1 쿼리는 반드시 거리 기준 `ORDER BY`를 포함한다 (`staticParkingCache.ts`가 `ORDER BY` 없이 `LIMIT`만 걸어 지리적으로 편향된 결과를 반환했던 버그를 반복하지 않는다).
- `Festival.source = "city-scraped"`는 `festivalService.ts`의 `sourcePriority()`에서 기존 모든 소스(`tourapi`=3, `area-based-tour`=2, `public-data-culture-festival`=1, `keyword-tour`=0)보다 낮은 `-1`을 받는다 — 중복 시 공공 API 데이터가 항상 우선한다.
- worker-backend에는 현재 테스트 러너가 없다. 이번 계획에서 `vitest ^2.1.8`(backend와 동일 버전)을 devDependency로 추가하고 `"test": "vitest run"` 스크립트를 만든다. 테스트 파일은 `worker-backend/tests/*.test.ts`에 둔다 (backend의 `backend/tests/` 관례를 그대로 따름).
- D1을 직접 건드리는 코드(`cityFestivalCache.ts`의 `queryCityFestivalsFromCache`, `cityFestivalDiscovery.ts`의 batch upsert)는 이 저장소의 기존 관례상 단위 테스트 대상이 아니다 (`staticParkingCache.ts`, `localEvents.ts` 등 기존 D1 쿼리 함수 어디에도 단위 테스트가 없음). 순수 로직(파서, 정규화, 점수 계산, D1 row → Festival 매핑)만 vitest로 TDD하고, D1 쿼리 자체는 typecheck + 배포 후 수동 curl/wrangler d1 execute 스모크 테스트로 검증한다.
- 새 provider가 읽는 `city_festivals` 좌표 해석은 기존 geocode 캐시(`geocode_cache` D1 테이블, `getGeocodeStore()`)를 **읽기 전용**으로만 사용한다. 새 주소에 대한 실시간 Kakao geocode 호출은 이번 스코프에 포함하지 않는다 — 캐시에 없으면 `CitySiteConfig.fallbackLat/fallbackLng`로 즉시 폴백한다 (불이익 없음).

---

## Task 1: D1 migration — `city_festivals` 테이블

**Files:**
- Create: `worker-backend/migrations/0015_city_festivals.sql`

**Interfaces:**
- Produces: `city_festivals` 테이블 (컬럼: `id, site_id, source_url, title, start_date, end_date, venue, address, lat, lng, image_url, score, scraped_at`), 이후 모든 태스크가 이 스키마를 전제로 한다.

- [ ] **Step 1: migration 파일 작성**

`worker-backend/migrations/0015_city_festivals.sql`:

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

CREATE UNIQUE INDEX idx_city_festivals_site_title_start ON city_festivals(site_id, title, start_date);
CREATE INDEX idx_city_festivals_lat_lng ON city_festivals(lat, lng);
```

- [ ] **Step 2: 로컬 D1에 적용해 스키마 확인**

Run: `pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --local --file ./migrations/0015_city_festivals.sql`

Expected: 에러 없이 완료. 이어서 `pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --local --command "SELECT sql FROM sqlite_master WHERE name='city_festivals'"` 실행 시 위 `CREATE TABLE` 문이 그대로 출력됨.

- [ ] **Step 3: Commit**

```bash
git add worker-backend/migrations/0015_city_festivals.sql && git commit -m "Add city_festivals D1 table migration"
```

---

## Task 2: worker-backend 테스트 인프라 + 선언적 HTML 파서

**Files:**
- Create: `worker-backend/vitest.config.ts`
- Modify: `worker-backend/package.json`
- Create: `worker-backend/src/cityFestivalParsers/types.ts`
- Create: `worker-backend/src/cityFestivalParsers/declarativeParser.ts`
- Test: `worker-backend/tests/declarativeParser.test.ts`

**Interfaces:**
- Produces: `RawCityFestivalCandidate` (title/startDateRaw/endDateRaw/venueRaw/addressRaw/detailUrl/imageUrl, 전부 `string | null`), `CitySiteConfig` (siteId/cityName/listUrl/fallbackLat/fallbackLng/robotsCheckedAt/selectors?/customParser?), `parseDeclarative(html: string, config: CitySiteConfig): RawCityFestivalCandidate[]` — 이후 모든 파싱/정규화/오케스트레이션 태스크가 이 두 타입과 함수를 사용한다.

- [ ] **Step 1: worker-backend에 vitest, cheerio 추가**

`worker-backend/package.json`을 다음과 같이 수정 (기존 필드는 그대로 두고 `scripts.test`, `dependencies.cheerio`, `devDependencies.vitest`만 추가):

```json
{
  "name": "@parking/worker-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@parking/shared-types": "file:../shared-types",
    "cheerio": "^1.0.0",
    "hono": "^4.7.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "latest",
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "wrangler": "latest"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: vitest config 작성**

`worker-backend/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

Run: `mkdir -p worker-backend/tests`

- [ ] **Step 3: 타입 정의**

`worker-backend/src/cityFestivalParsers/types.ts`:

```typescript
export interface RawCityFestivalCandidate {
  title: string | null;
  startDateRaw: string | null;
  endDateRaw: string | null;
  venueRaw: string | null;
  addressRaw: string | null;
  detailUrl: string | null;
  imageUrl: string | null;
}

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
  };
  customParser?: string;
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`worker-backend/tests/declarativeParser.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseDeclarative } from "../src/cityFestivalParsers/declarativeParser.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";

const tableConfig: CitySiteConfig = {
  siteId: "test-table",
  cityName: "테스트시",
  listUrl: "https://example.com/festivals",
  fallbackLat: 37.5,
  fallbackLng: 127.0,
  robotsCheckedAt: "2026-07-28",
  selectors: {
    itemSelector: "tr.row",
    titleSelector: "td.title a",
    dateSelector: "td.date",
    linkSelector: "td.title a",
    imageSelector: "td.thumb img"
  }
};

describe("parseDeclarative", () => {
  it("extracts candidates from a table-based board using configured selectors", () => {
    const html = `
      <table><tbody>
        <tr class="row">
          <td class="thumb"><img src="/img/1.jpg" /></td>
          <td class="title"><a href="/detail/1">가을 단풍 축제</a></td>
          <td class="date">2026.10.01 ~ 2026.10.03</td>
        </tr>
        <tr class="row">
          <td class="thumb"><img src="/img/2.jpg" /></td>
          <td class="title"><a href="/detail/2">겨울 빛 축제</a></td>
          <td class="date">2026.12.20 ~ 2026.12.25</td>
        </tr>
      </tbody></table>
    `;

    const result = parseDeclarative(html, tableConfig);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: "가을 단풍 축제",
      startDateRaw: "2026.10.01 ~ 2026.10.03",
      endDateRaw: "2026.10.01 ~ 2026.10.03",
      venueRaw: null,
      addressRaw: null,
      detailUrl: "https://example.com/detail/1",
      imageUrl: "https://example.com/img/1.jpg"
    });
  });

  it("returns an empty array when the site config has no selectors (custom-parser sites)", () => {
    const noSelectorConfig: CitySiteConfig = { ...tableConfig, selectors: undefined };
    expect(parseDeclarative("<html></html>", noSelectorConfig)).toEqual([]);
  });

  it("skips items with no matching link and returns null detailUrl/imageUrl instead of throwing", () => {
    const html = `<table><tbody><tr class="row"><td class="title">링크 없는 항목</td><td class="date">2026.11.01</td></tr></tbody></table>`;
    const result = parseDeclarative(html, tableConfig);
    expect(result).toHaveLength(1);
    expect(result[0].detailUrl).toBeNull();
    expect(result[0].imageUrl).toBeNull();
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm -C worker-backend test`

Expected: FAIL — `Cannot find module '../src/cityFestivalParsers/declarativeParser.js'`

- [ ] **Step 6: 구현**

`worker-backend/src/cityFestivalParsers/declarativeParser.ts`:

```typescript
import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./types.js";

export function parseDeclarative(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  if (!config.selectors) return [];
  const { itemSelector, titleSelector, dateSelector, linkSelector, imageSelector } =
    config.selectors;
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

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw: null,
      addressRaw: null,
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

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm -C worker-backend test`

Expected: PASS (3/3)

- [ ] **Step 8: cheerio가 Workers 번들에 실제로 포함되는지 확인**

vitest는 Node 환경에서 돌기 때문에 cheerio가 실제 Cloudflare Workers 런타임으로 번들링되는지는 검증하지 않는다. 배포 없이 빌드만 확인한다.

Run: `pnpm -C worker-backend typecheck && pnpm -C worker-backend exec wrangler deploy --dry-run`

Expected: 둘 다 에러 없이 완료. `wrangler deploy --dry-run`이 cheerio 관련 번들링 에러(네이티브 모듈, Node-only API 사용 등)를 내면 이 태스크를 완료로 표시하지 말고 원인을 먼저 해결한다.

- [ ] **Step 9: Commit**

```bash
git add worker-backend/package.json worker-backend/pnpm-lock.yaml worker-backend/vitest.config.ts worker-backend/src/cityFestivalParsers/types.ts worker-backend/src/cityFestivalParsers/declarativeParser.ts worker-backend/tests/declarativeParser.test.ts && git commit -m "Add vitest to worker-backend and declarative HTML parser for city festival sites"
```

(루트 lockfile이 pnpm workspace 방식이라면 `worker-backend/pnpm-lock.yaml` 대신 루트의 `pnpm-lock.yaml`을 add한다 — `git status`로 실제 변경된 lockfile 경로를 확인한다.)

---

## Task 3: 날짜/좌표 정규화

**Files:**
- Create: `worker-backend/src/cityFestivalNormalize.ts`
- Test: `worker-backend/tests/cityFestivalNormalize.test.ts`

**Interfaces:**
- Consumes: `RawCityFestivalCandidate`, `CitySiteConfig` (Task 2), `getGeocodeStore()`/`setGeocodeStore()`/`GeocodeStore`/`GeocodeStoreEntry` from `backend/src/features/discover/events/eventProviderUtils.ts` (기존, 수정 없음).
- Produces: `NormalizedCityFestival` (siteId/sourceUrl/hasDetailUrl/title/startDate/endDate/venue/address/lat/lng/imageUrl), `normalizeCandidate(candidate, config): Promise<NormalizedCityFestival | null>`, `parseCityDateRange(startRaw, endRaw): { startDate: string; endDate: string } | null` — Task 4(점수 계산)와 Task 6(오케스트레이션)이 이 타입/함수를 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/cityFestivalNormalize.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { setGeocodeStore } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import type { GeocodeStore, GeocodeStoreEntry } from "../../backend/src/features/discover/events/eventProviderUtils.js";
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

afterEach(() => {
  setGeocodeStore(null);
});

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

  it("falls back to config coordinates when there is no address", async () => {
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

  it("uses the geocode cache when an address is present and a cached entry is found", async () => {
    const fakeStore: GeocodeStore = {
      async getMany(queries: string[]) {
        const map = new Map<string, GeocodeStoreEntry>();
        for (const query of queries) {
          map.set(query, { found: true, lat: 36.1, lng: 128.4, address: query, venue: null });
        }
        return map;
      },
      async setMany() {}
    };
    setGeocodeStore(fakeStore);

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "테스트시 테스트로 1" },
      config
    );
    expect(result?.lat).toBe(36.1);
    expect(result?.lng).toBe(128.4);
  });

  it("falls back to config coordinates when the address has no cached geocode entry", async () => {
    const fakeStore: GeocodeStore = {
      async getMany() {
        return new Map();
      },
      async setMany() {}
    };
    setGeocodeStore(fakeStore);

    const result = await normalizeCandidate(
      { ...baseCandidate, addressRaw: "미등록 주소" },
      config
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

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm -C worker-backend test`

Expected: FAIL — `Cannot find module '../src/cityFestivalNormalize.js'`

- [ ] **Step 3: 구현**

`worker-backend/src/cityFestivalNormalize.ts`:

```typescript
import { getGeocodeStore } from "../../backend/src/features/discover/events/eventProviderUtils.js";
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
  addressRaw: string | null,
  fallbackLat: number,
  fallbackLng: number
): Promise<{ lat: number; lng: number }> {
  const query = addressRaw?.trim();
  if (!query) return { lat: fallbackLat, lng: fallbackLng };

  const store = getGeocodeStore();
  if (!store) return { lat: fallbackLat, lng: fallbackLng };

  try {
    const entries = await store.getMany([query]);
    const entry = entries.get(query);
    if (entry?.found && entry.lat !== null && entry.lng !== null) {
      return { lat: entry.lat, lng: entry.lng };
    }
  } catch {
    // best-effort: geocode 캐시 조회 실패는 fallback 좌표로 무시한다
  }
  return { lat: fallbackLat, lng: fallbackLng };
}

export async function normalizeCandidate(
  candidate: RawCityFestivalCandidate,
  config: CitySiteConfig
): Promise<NormalizedCityFestival | null> {
  const title = candidate.title?.trim();
  if (!title) return null;

  const dateRange = parseCityDateRange(candidate.startDateRaw, candidate.endDateRaw);
  if (!dateRange) return null;

  const { lat, lng } = await resolveCoordinates(
    candidate.addressRaw,
    config.fallbackLat,
    config.fallbackLng
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

- [ ] **Step 4: 테스트 통과 확인 + typecheck**

Run: `pnpm -C worker-backend test && pnpm -C worker-backend typecheck`

Expected: 모든 테스트 PASS, typecheck 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add worker-backend/src/cityFestivalNormalize.ts worker-backend/tests/cityFestivalNormalize.test.ts && git commit -m "Add date/coordinate normalization for scraped city festival candidates"
```

---

## Task 4: 신뢰 점수 계산

**Files:**
- Create: `worker-backend/src/cityFestivalScore.ts`
- Test: `worker-backend/tests/cityFestivalScore.test.ts`

**Interfaces:**
- Consumes: `NormalizedCityFestival` (Task 3).
- Produces: `scoreCandidate(normalized: NormalizedCityFestival): number` (0~1.0), `isWithinKoreaBounds(lat: number, lng: number): boolean` — Task 6(오케스트레이션)이 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/cityFestivalScore.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isWithinKoreaBounds, scoreCandidate } from "../src/cityFestivalScore.js";
import type { NormalizedCityFestival } from "../src/cityFestivalNormalize.js";

const full: NormalizedCityFestival = {
  siteId: "test-city",
  sourceUrl: "https://example.com/detail/1",
  hasDetailUrl: true,
  title: "가을 단풍 축제",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  venue: "시청 광장",
  address: "테스트시 테스트로 1",
  lat: 37.5,
  lng: 127.0,
  imageUrl: "https://example.com/img/1.jpg"
};

describe("isWithinKoreaBounds", () => {
  it("accepts coordinates inside the Korean peninsula bounding box", () => {
    expect(isWithinKoreaBounds(37.5, 127.0)).toBe(true);
  });

  it("rejects coordinates far outside Korea", () => {
    expect(isWithinKoreaBounds(0, 0)).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("scores a fully populated candidate at 1.0", () => {
    expect(scoreCandidate(full)).toBeCloseTo(1.0);
  });

  it("drops the 0.2 detail-url bonus when hasDetailUrl is false", () => {
    expect(scoreCandidate({ ...full, hasDetailUrl: false })).toBeCloseTo(0.8);
  });

  it("drops the 0.2 korea-bounds bonus when coordinates are out of range", () => {
    expect(scoreCandidate({ ...full, lat: 0, lng: 0 })).toBeCloseTo(0.8);
  });

  it("drops the 0.3 title bonus when the title is a single character", () => {
    expect(scoreCandidate({ ...full, title: "축" })).toBeCloseTo(0.7);
  });

  it("drops the 0.3 date bonus when startDate is after endDate", () => {
    expect(scoreCandidate({ ...full, startDate: "2026-10-05", endDate: "2026-10-01" })).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm -C worker-backend test`

Expected: FAIL — `Cannot find module '../src/cityFestivalScore.js'`

- [ ] **Step 3: 구현**

`worker-backend/src/cityFestivalScore.ts`:

```typescript
import type { NormalizedCityFestival } from "./cityFestivalNormalize.js";

export function isWithinKoreaBounds(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

export function scoreCandidate(normalized: NormalizedCityFestival): number {
  let score = 0;
  if (normalized.title.length >= 2) score += 0.3;
  if (normalized.startDate <= normalized.endDate) score += 0.3;
  if (isWithinKoreaBounds(normalized.lat, normalized.lng)) score += 0.2;
  if (normalized.hasDetailUrl) score += 0.2;
  return score;
}
```

- [ ] **Step 4: 테스트 통과 확인 + typecheck**

Run: `pnpm -C worker-backend test && pnpm -C worker-backend typecheck`

Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add worker-backend/src/cityFestivalScore.ts worker-backend/tests/cityFestivalScore.test.ts && git commit -m "Add trust score calculation for scraped city festival candidates"
```

---

## Task 5: 사이트 설정 배열 + custom parser 레지스트리

**Files:**
- Create: `worker-backend/src/cityFestivalSites.ts`
- Create: `worker-backend/src/cityFestivalParsers/customParsers/index.ts`

**Interfaces:**
- Consumes: `CitySiteConfig`, `RawCityFestivalCandidate` (Task 2).
- Produces: `CITY_FESTIVAL_SITES: CitySiteConfig[]` (이번 태스크에서는 빈 배열 — Task 11에서 실제 파일럿 사이트로 채워진다), `CUSTOM_PARSERS: Record<string, CustomParserFn>` (이번 태스크에서는 빈 객체), `CustomParserFn` 타입 — Task 6(오케스트레이션)이 이 세 심볼을 사용한다.

- [ ] **Step 1: 사이트 설정 배열**

`worker-backend/src/cityFestivalSites.ts`:

```typescript
import type { CitySiteConfig } from "./cityFestivalParsers/types.js";

// 파일럿 사이트는 아직 등록되지 않았다. 실제 시/군/구 사이트를 추가하려면
// 해당 사이트의 raw HTML을 직접 열어 셀렉터를 확인한 뒤 항목을 추가한다
// (docs/superpowers/plans/2026-07-28-city-festival-scraper-plan.md Task 11 참고).
export const CITY_FESTIVAL_SITES: CitySiteConfig[] = [];
```

- [ ] **Step 2: custom parser 레지스트리**

`worker-backend/src/cityFestivalParsers/customParsers/index.ts`:

```typescript
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

export type CustomParserFn = (html: string, config: CitySiteConfig) => RawCityFestivalCandidate[];

// selectors만으로 표현 안 되는 사이트(JS 렌더링 위젯, 비정형 마크업 등)를 위한
// 탈출구. siteId를 키로 등록하고, CitySiteConfig.customParser에 같은 키를 지정한다.
export const CUSTOM_PARSERS: Record<string, CustomParserFn> = {};
```

- [ ] **Step 3: typecheck으로 검증**

Run: `pnpm -C worker-backend typecheck`

Expected: 에러 없음. (빈 배열/객체이므로 별도 단위 테스트는 불필요 — 타입 정합성만 typecheck으로 확인한다.)

- [ ] **Step 4: Commit**

```bash
git add worker-backend/src/cityFestivalSites.ts worker-backend/src/cityFestivalParsers/customParsers/index.ts && git commit -m "Add city festival site config array and custom parser registry scaffolding"
```

---

## Task 6: geocode store 추출 + 배치 오케스트레이션

`createD1GeocodeStore`가 현재 `worker-backend/src/index.ts` 안에 비공개 함수로 존재한다. 오케스트레이션 잡이 (index.ts를 다시 import하는 순환 참조 없이) 이 함수를 재사용할 수 있도록 먼저 별도 파일로 추출한다.

**Files:**
- Create: `worker-backend/src/geocodeStore.ts`
- Modify: `worker-backend/src/index.ts:1233-1309` (`GeocodeCacheRow`/`D1GeocodeEntry`/`createD1GeocodeStore` 정의 삭제 후 import로 교체), 그리고 이 함수를 호출하는 두 지점(`loadDiscoveryRuntime` 안 약 1071번 줄, `importBackend` 안 약 1218번 줄)
- Create: `worker-backend/src/cityFestivalDiscovery.ts`
- Test: `worker-backend/tests/cityFestivalDiscovery.test.ts`

**Interfaces:**
- Consumes: `CitySiteConfig`, `RawCityFestivalCandidate` (Task 2), `parseDeclarative` (Task 2), `normalizeCandidate`, `NormalizedCityFestival` (Task 3), `scoreCandidate` (Task 4), `CITY_FESTIVAL_SITES`, `CUSTOM_PARSERS`, `CustomParserFn` (Task 5), `fetchWithTimeout`, `setGeocodeStore` from `backend/src/features/discover/events/eventProviderUtils.ts` (기존, 수정 없음), `Env` 타입 (`worker-backend/src/index.ts`, type-only import).
- Produces: `createD1GeocodeStore(db: D1Database)` (from `geocodeStore.ts`, Task 10의 `index.ts` 배선이 그대로 재사용), `runCityFestivalDiscovery(db: D1Database, env: Env, sites?: CitySiteConfig[]): Promise<{ processed: number; published: number; failedSites: string[] }>` — Task 10이 cron 분기와 admin route에서 이 함수를 호출한다.

- [ ] **Step 1: `createD1GeocodeStore`를 `geocodeStore.ts`로 추출**

`worker-backend/src/geocodeStore.ts` (내용은 `worker-backend/src/index.ts`의 기존 `GeocodeCacheRow`/`D1GeocodeEntry`/`createD1GeocodeStore`를 그대로 옮긴 것):

```typescript
interface GeocodeCacheRow {
  query: string;
  found: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
  venue: string | null;
}

export interface D1GeocodeEntry {
  found: boolean;
  lat: number | null;
  lng: number | null;
  address: string | null;
  venue: string | null;
}

export function createD1GeocodeStore(db: D1Database): {
  getMany(queries: string[]): Promise<Map<string, D1GeocodeEntry>>;
  setMany(entries: Array<{ query: string; entry: D1GeocodeEntry }>): Promise<void>;
} {
  return {
    async getMany(queries) {
      const result = new Map<string, D1GeocodeEntry>();
      if (queries.length === 0) return result;
      const placeholders = queries.map(() => "?").join(",");
      const rows = await db
        .prepare(
          `SELECT query, found, lat, lng, address, venue
             FROM geocode_cache
            WHERE query IN (${placeholders})`
        )
        .bind(...queries)
        .all<GeocodeCacheRow>();
      for (const row of rows.results ?? []) {
        result.set(row.query, {
          found: Boolean(row.found),
          lat: row.lat,
          lng: row.lng,
          address: row.address,
          venue: row.venue
        });
      }
      return result;
    },
    async setMany(entries) {
      if (entries.length === 0) return;
      const cachedAt = new Date().toISOString();
      const statements = entries.map(({ query, entry }) =>
        db
          .prepare(
            `INSERT INTO geocode_cache (query, found, lat, lng, address, venue, cached_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(query) DO UPDATE SET
               found = excluded.found,
               lat = excluded.lat,
               lng = excluded.lng,
               address = excluded.address,
               venue = excluded.venue,
               cached_at = excluded.cached_at`
          )
          .bind(query, entry.found ? 1 : 0, entry.lat, entry.lng, entry.address, entry.venue, cachedAt)
      );
      await db.batch(statements);
    }
  };
}
```

- [ ] **Step 2: `index.ts`에서 옛 정의를 지우고 import로 교체**

`worker-backend/src/index.ts`에서 `interface GeocodeCacheRow { ... }`부터 `function createD1GeocodeStore(db: D1Database): { ... } { ... }`까지(약 1233~1309번 줄) 전체 블록을 삭제한다.

파일 상단 import 목록에 다음 줄을 추가한다:

```typescript
import { createD1GeocodeStore } from "./geocodeStore.js";
```

`loadDiscoveryRuntime` 함수(약 1055번 줄 시작) 안의 `if (env.DB) setGeocodeStore(createD1GeocodeStore(env.DB));`와 `importBackend` 함수(약 1198번 줄 시작) 안의 `setGeocodeStore(createD1GeocodeStore(env.DB));` 호출부는 코드 그대로 둔다 — 이제 로컬 함수 대신 import된 `createD1GeocodeStore`를 참조하게 된다.

- [ ] **Step 3: typecheck으로 추출이 깨지지 않았는지 확인**

Run: `pnpm -C worker-backend typecheck`

Expected: 에러 없음.

- [ ] **Step 4: Commit (추출만 별도 커밋)**

```bash
git add worker-backend/src/geocodeStore.ts worker-backend/src/index.ts && git commit -m "Extract createD1GeocodeStore into its own module for reuse outside index.ts"
```

- [ ] **Step 5: 오케스트레이션 실패하는 테스트 작성**

`worker-backend/tests/cityFestivalDiscovery.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCityFestivalDiscovery } from "../src/cityFestivalDiscovery.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";
import type { Env } from "../src/index.js";

function fakeDb(): { db: D1Database; batch: ReturnType<typeof vi.fn> } {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: () => ({ bind: () => ({}) }),
    batch
  } as unknown as D1Database;
  return { db, batch };
}

function fakeEnv(): Env {
  return {} as Env;
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
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `pnpm -C worker-backend test`

Expected: FAIL — `Cannot find module '../src/cityFestivalDiscovery.js'`

- [ ] **Step 7: 구현**

`worker-backend/src/cityFestivalDiscovery.ts`:

```typescript
import { fetchWithTimeout, setGeocodeStore } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { CUSTOM_PARSERS } from "./cityFestivalParsers/customParsers/index.js";
import { parseDeclarative } from "./cityFestivalParsers/declarativeParser.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./cityFestivalParsers/types.js";
import { CITY_FESTIVAL_SITES } from "./cityFestivalSites.js";
import { createD1GeocodeStore } from "./geocodeStore.js";
import { normalizeCandidate } from "./cityFestivalNormalize.js";
import type { NormalizedCityFestival } from "./cityFestivalNormalize.js";
import { scoreCandidate } from "./cityFestivalScore.js";
import type { Env } from "./index.js";

const CITY_FESTIVAL_INTER_SITE_DELAY_MS = 300;
const CITY_FESTIVAL_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_AUTO_PUBLISH_MIN_SCORE = 0.7;

export interface CityFestivalDiscoveryResult {
  processed: number;
  published: number;
  failedSites: string[];
}

export async function runCityFestivalDiscovery(
  db: D1Database,
  env: Env,
  sites: CitySiteConfig[] = CITY_FESTIVAL_SITES
): Promise<CityFestivalDiscoveryResult> {
  setGeocodeStore(createD1GeocodeStore(db));

  const rawThreshold = Number(env.CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE ?? DEFAULT_AUTO_PUBLISH_MIN_SCORE);
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : DEFAULT_AUTO_PUBLISH_MIN_SCORE;

  let processed = 0;
  let published = 0;
  const failedSites: string[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const site of sites) {
    try {
      const candidates = await discoverSite(site);
      processed += candidates.length;
      for (const candidate of candidates) {
        const normalized = await normalizeCandidate(candidate, site);
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

  return { processed, published, failedSites };
}

async function discoverSite(site: CitySiteConfig): Promise<RawCityFestivalCandidate[]> {
  const response = await fetchWithTimeout(
    new URL(site.listUrl),
    { headers: { "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0" } },
    CITY_FESTIVAL_FETCH_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`city festival site fetch failed: ${response.status}`);
  }
  const html = await response.text();

  if (site.customParser) {
    const parser = CUSTOM_PARSERS[site.customParser];
    if (!parser) {
      throw new Error(`no custom parser registered for customParser=${site.customParser}`);
    }
    return parser(html, site);
  }
  return parseDeclarative(html, site);
}

function buildUpsertStatement(
  db: D1Database,
  normalized: NormalizedCityFestival,
  score: number
): D1PreparedStatement {
  const id = buildCityFestivalId(normalized.siteId, normalized.title, normalized.startDate);
  const scrapedAt = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO city_festivals (
        id, site_id, source_url, title, start_date, end_date, venue, address, lat, lng, image_url, score, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        venue = excluded.venue,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        image_url = excluded.image_url,
        score = excluded.score,
        scraped_at = excluded.scraped_at`
    )
    .bind(
      id,
      normalized.siteId,
      normalized.sourceUrl,
      normalized.title,
      normalized.startDate,
      normalized.endDate,
      normalized.venue,
      normalized.address,
      normalized.lat,
      normalized.lng,
      normalized.imageUrl,
      score,
      scrapedAt
    );
}

function buildCityFestivalId(siteId: string, title: string, startDate: string): string {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  const raw = `${siteId}:${normalizedTitle}:${startDate}`;
  return `city:${djb2(raw)}`;
}

function djb2(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 8: 테스트 통과 확인 + typecheck**

Run: `pnpm -C worker-backend test && pnpm -C worker-backend typecheck`

Expected: 모든 테스트 PASS, typecheck 에러 없음. (`Env` 타입을 `cityFestivalDiscovery.ts`가 `import type`으로만 가져오고 `index.ts`가 아직 `cityFestivalDiscovery.ts`를 import하지 않으므로 이 시점엔 순환 참조가 생기지 않는다 — Task 10에서 `index.ts`가 이 파일을 import하게 되면 `Env`는 여전히 type-only이므로 런타임 순환은 발생하지 않는다.)

- [ ] **Step 9: Commit**

```bash
git add worker-backend/src/cityFestivalDiscovery.ts worker-backend/tests/cityFestivalDiscovery.test.ts && git commit -m "Add city festival discovery orchestrator with per-site error isolation"
```

---

## Task 7: D1 읽기 캐시 쿼리

**Files:**
- Create: `worker-backend/src/cityFestivalCache.ts`
- Test: `worker-backend/tests/cityFestivalCache.test.ts`

**Interfaces:**
- Produces: `queryCityFestivalsFromCache(db: D1Database, lat: number, lng: number, radiusMeters: number, upcomingWithinDays: number): Promise<Festival[]>`, `mapCityFestivalRow(row: CityFestivalRow, lat: number, lng: number): Festival | null` — Task 8(`CityScrapedFestivalProvider`)이 `queryCityFestivalsFromCache`를 사용한다.

- [ ] **Step 1: 순수 매핑 함수의 실패하는 테스트 작성**

`worker-backend/tests/cityFestivalCache.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mapCityFestivalRow } from "../src/cityFestivalCache.js";

describe("mapCityFestivalRow", () => {
  const baseRow = {
    id: "city:abc123",
    site_id: "test-city",
    source_url: "https://example.com/detail/1",
    title: "가을 단풍 축제",
    start_date: "2026-10-01",
    end_date: "2026-10-03",
    venue: "시청 광장",
    address: "테스트시 테스트로 1",
    lat: 37.5,
    lng: 127.0,
    image_url: "https://example.com/img/1.jpg"
  };

  it("maps a valid row to a Festival with source=city-scraped and a computed distance", () => {
    const result = mapCityFestivalRow(baseRow, 37.5, 127.0);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("city-scraped");
    expect(result?.title).toBe("가을 단풍 축제");
    expect(result?.distanceMeters).toBe(0);
    expect(result?.sourceUrl).toBe("https://example.com/detail/1");
  });

  it("returns null when the row has no id", () => {
    expect(mapCityFestivalRow({ ...baseRow, id: "" }, 37.5, 127.0)).toBeNull();
  });

  it("returns null when lat/lng are not finite numbers", () => {
    expect(mapCityFestivalRow({ ...baseRow, lat: NaN }, 37.5, 127.0)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm -C worker-backend test`

Expected: FAIL — `Cannot find module '../src/cityFestivalCache.js'`

- [ ] **Step 3: 구현**

`worker-backend/src/cityFestivalCache.ts`:

```typescript
import type { Festival } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";
import { discoverStatus, isWithinWindow } from "../../backend/src/features/discover/common/dateUtils.js";

const CITY_FESTIVAL_RESULT_LIMIT = 500;
const CITY_FESTIVAL_PREFETCH_LIMIT = 5000;

export interface CityFestivalRow {
  id: string;
  site_id: string;
  source_url: string;
  title: string;
  start_date: string;
  end_date: string;
  venue: string | null;
  address: string | null;
  lat: number;
  lng: number;
  image_url: string | null;
}

export async function queryCityFestivalsFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  radiusMeters: number,
  upcomingWithinDays: number
): Promise<Festival[]> {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const rows = await db
    .prepare(
      `SELECT id, site_id, source_url, title, start_date, end_date, venue, address, lat, lng, image_url
         FROM city_festivals
        WHERE lat BETWEEN ? AND ?
          AND lng BETWEEN ? AND ?
        ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?)) ASC
        LIMIT ?`
    )
    .bind(
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      lat,
      lat,
      lng,
      lng,
      CITY_FESTIVAL_PREFETCH_LIMIT
    )
    .all<CityFestivalRow>();

  return (rows.results ?? [])
    .map((row) => mapCityFestivalRow(row, lat, lng))
    .filter((item): item is Festival => item !== null)
    .filter((item) => item.distanceMeters <= radiusMeters)
    .filter((item) => isWithinWindow(item.startDate, item.endDate, upcomingWithinDays))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, CITY_FESTIVAL_RESULT_LIMIT);
}

export function mapCityFestivalRow(row: CityFestivalRow, lat: number, lng: number): Festival | null {
  if (!row.id || !row.title || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  return {
    id: row.id,
    title: row.title,
    subtitle: null,
    description: null,
    startDate: row.start_date,
    endDate: row.end_date,
    status: discoverStatus(row.start_date, row.end_date),
    venueName: row.venue,
    address: row.address ?? "",
    lat: row.lat,
    lng: row.lng,
    distanceMeters: distanceMeters(lat, lng, row.lat, row.lng),
    source: "city-scraped",
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    tags: []
  };
}
```

- [ ] **Step 4: 테스트 통과 확인 + typecheck**

Run: `pnpm -C worker-backend test && pnpm -C worker-backend typecheck`

Expected: 모든 테스트 PASS.

- [ ] **Step 5: Commit**

```bash
git add worker-backend/src/cityFestivalCache.ts worker-backend/tests/cityFestivalCache.test.ts && git commit -m "Add D1 read cache query for scraped city festivals"
```

---

## Task 8: `CityScrapedFestivalProvider`

**Files:**
- Create: `worker-backend/src/cityScrapedFestivalProvider.ts`

**Interfaces:**
- Consumes: `queryCityFestivalsFromCache` (Task 7), `FestivalProvider`/`DiscoverQuery` from `backend/src/features/discover/common/discoverProvider.ts` (기존, 수정 없음), `BaseProviderHealth` from `backend/src/providers/BaseProviderHealth.ts` (기존, 수정 없음).
- Produces: `CityScrapedFestivalProvider` 클래스 (`festivals(query)`, `health()`) — Task 9(`festivalService.ts`의 `createFestivalService`)와 Task 10(`index.ts`의 `importBackend`)이 이 클래스를 사용한다.

이 파일은 `queryCityFestivalsFromCache`(Task 7에서 이미 테스트됨)를 그대로 위임하는 얇은 래퍼이므로 분기 로직이 없다. Global Constraints에 따라 D1 접근 코드는 typecheck + 배포 후 스모크 테스트로 검증하고 별도 단위 테스트는 작성하지 않는다.

- [ ] **Step 1: 구현**

`worker-backend/src/cityScrapedFestivalProvider.ts`:

```typescript
import type { Festival } from "@parking/shared-types";
import { BaseProviderHealth } from "../../backend/src/providers/BaseProviderHealth.js";
import type { DiscoverQuery, FestivalProvider } from "../../backend/src/features/discover/common/discoverProvider.js";
import { queryCityFestivalsFromCache } from "./cityFestivalCache.js";

export class CityScrapedFestivalProvider extends BaseProviderHealth implements FestivalProvider {
  constructor(private readonly db: D1Database) {
    super("city-scraped");
  }

  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    try {
      const items = await queryCityFestivalsFromCache(
        this.db,
        query.lat,
        query.lng,
        query.radiusMeters,
        query.upcomingWithinDays
      );
      this.markSuccess(items.length > 0 ? 0.8 : 0.6);
      return items;
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}
```

- [ ] **Step 2: typecheck으로 검증**

Run: `pnpm -C worker-backend typecheck`

Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add worker-backend/src/cityScrapedFestivalProvider.ts && git commit -m "Add CityScrapedFestivalProvider implementing the existing FestivalProvider interface"
```

---

## Task 9: `festivalService.ts`에 extraProviders 주입 + city-scraped 최하위 우선순위

**Files:**
- Modify: `backend/src/features/discover/festivals/festivalService.ts`
- Modify: `backend/tests/festivalServicePriority.test.ts`

**Interfaces:**
- Consumes: `FestivalProvider` (기존).
- Produces: `createFestivalService(extraProviders?: FestivalProvider[]): FestivalService` (기존 시그니처를 하위 호환 확장 — 기존 `createFestivalService()` 무인자 호출은 그대로 동작) — Task 10(`index.ts`의 `importBackend`)이 `createFestivalService([new CityScrapedFestivalProvider(env.DB)])` 형태로 호출한다.

- [ ] **Step 1: 실패하는 테스트 추가**

`backend/tests/festivalServicePriority.test.ts`에서 파일 상단 import에 `createFestivalService`를 추가:

```typescript
import { FestivalService, createFestivalService } from "../src/features/discover/festivals/festivalService.js";
```

같은 파일의 첫 번째 `describe` 블록(`"FestivalService source priority"`) 안, 기존 두 `it` 다음에 아래 두 테스트를 추가한다 (닫는 `});` 앞):

```typescript

  it("keeps keyword-tour over city-scraped when duplicate festivals arrive from both", async () => {
    const service = new FestivalService([
      providerForSource("city-scraped"),
      providerForSource("keyword-tour"),
    ]);

    const items = await service.nearby({
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12347,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("keyword-tour");
  });

  it("keeps area-based-tour over city-scraped when duplicate festivals arrive from both", async () => {
    const service = new FestivalService([
      providerForSource("city-scraped"),
      providerForSource("area-based-tour"),
    ]);

    const items = await service.nearby({
      lat: 37.1,
      lng: 127.1,
      radiusMeters: 12348,
      upcomingWithinDays: 36500
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("area-based-tour");
  });
```

파일 끝에 새 `describe` 블록을 추가한다:

```typescript

describe("createFestivalService extraProviders", () => {
  it("includes extra providers passed in, regardless of which provider-mode branch runs", async () => {
    const extra = providerForSource("city-scraped");
    const service = createFestivalService([extra]);
    const names = service.health().map((entry) => entry.name);
    expect(names).toContain("city-scraped");
  });
});
```

(반경(`radiusMeters`)을 12347/12348처럼 기존 테스트와 겹치지 않게 다른 값으로 준 이유: `FestivalService.nearby()`가 모듈 레벨 `MemoryCache` 싱글턴을 쓰기 때문에, 같은 파일 안 여러 테스트가 같은 쿼리 키로 캐시를 공유하면 서로의 결과를 가로챈다 — 기존 두 테스트도 12345/12346으로 이미 이 패턴을 쓰고 있다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @parking/backend test`

Expected: FAIL — 새로 추가한 3개 테스트 중 최소 `createFestivalService extraProviders`가 city-scraped 항목을 못 찾아 실패 (아직 `extraProviders` 파라미터가 없으므로).

- [ ] **Step 3: `festivalService.ts` 수정**

`backend/src/features/discover/festivals/festivalService.ts`에서 `createFestivalService` 함수를 다음으로 교체:

```typescript
export function createFestivalService(
  extraProviders: FestivalProvider[] = [],
): FestivalService {
  if (config.NODE_ENV === "test") {
    return new FestivalService([new MockFestivalProvider(), ...extraProviders]);
  }
  if (!config.FESTIVAL_PROVIDER_ENABLED) {
    return new FestivalService([...extraProviders]);
  }
  const providers: FestivalProvider[] = [];
  if (config.PUBLIC_DATA_SERVICE_KEY) {
    providers.push(
      new TourApiFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
    providers.push(
      new NationalCultureFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        NATIONAL_CULTURE_FESTIVAL_BASE_URL,
      ),
    );
    providers.push(
      new TourApiAreaFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
    providers.push(
      new TourApiKeywordFestivalProvider(
        config.PUBLIC_DATA_SERVICE_KEY,
        config.PUBLIC_DATA_BASE_URL,
      ),
    );
  }
  if (providers.length === 0 && config.PARKING_PROVIDER_MODE === "mock") {
    providers.push(new MockFestivalProvider());
  }
  providers.push(...extraProviders);
  return new FestivalService(providers);
}
```

같은 파일의 `sourcePriority` 함수를 다음으로 교체:

```typescript
function sourcePriority(source: string): number {
  if (source === "tourapi") return 3;
  if (source === "area-based-tour") return 2;
  if (source === "public-data-culture-festival") return 1;
  if (source === "keyword-tour") return 0;
  if (source === "city-scraped") return -1;
  return 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @parking/backend test`

Expected: 모든 테스트 PASS (기존 테스트 포함 회귀 없음).

- [ ] **Step 5: preflight**

Run: `pnpm --filter @parking/backend preflight`

Expected: 통과.

- [ ] **Step 6: Commit**

```bash
git add backend/src/features/discover/festivals/festivalService.ts backend/tests/festivalServicePriority.test.ts && git commit -m "Let createFestivalService accept extra providers and rank city-scraped festivals lowest"
```

---

## Task 10: Worker 배선 — cron, admin route, provider 주입

**Files:**
- Modify: `worker-backend/src/index.ts` (Env 타입, `importBackend`, admin route, `scheduled()` 분기, helper 함수)
- Modify: `worker-backend/wrangler.toml`

**Interfaces:**
- Consumes: `runCityFestivalDiscovery` (Task 6), `CityScrapedFestivalProvider` (Task 8), `createFestivalService(extraProviders)` (Task 9).

- [ ] **Step 1: `Env` 타입에 새 필드 추가**

`worker-backend/src/index.ts`의 `type Env = { ... }` 블록에서 `OPS_ALERT_WEBHOOK_URL?: string;` 바로 앞에 한 줄 추가:

```typescript
  CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE?: string;
```

- [ ] **Step 2: import 추가**

파일 상단 import 목록에 추가:

```typescript
import { runCityFestivalDiscovery } from "./cityFestivalDiscovery.js";
```

- [ ] **Step 3: `importBackend()`에서 provider 주입**

`importBackend` 함수 안, 동적 import 배열에 `CityScrapedFestivalProvider`를 추가할 필요는 없다 (정적 import로 충분 — Workers 번들은 코드 스플리팅을 하지 않으므로). 파일 상단 import 목록에 추가:

```typescript
import { CityScrapedFestivalProvider } from "./cityScrapedFestivalProvider.js";
```

`importBackend` 함수의 `return { ... }` 블록에서 다음 줄:

```typescript
    festivalService: createFestivalService(),
```

을 다음으로 교체:

```typescript
    festivalService: createFestivalService(
      env.DB ? [new CityScrapedFestivalProvider(env.DB)] : [],
    ),
```

- [ ] **Step 4: admin sync route 추가**

`worker-backend/src/index.ts`에서 `/admin/sync-local-events` 라우트 정의 바로 뒤에 새 라우트를 추가:

```typescript
app.post("/admin/sync-city-festivals", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  try {
    const result = await runCityFestivalDiscovery(c.env.DB, c.env);
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});
```

- [ ] **Step 5: cron 스케줄 등록**

`worker-backend/wrangler.toml`의 `[triggers]` 블록:

```toml
[triggers]
crons = ["*/3 * * * *", "*/9 * * * *", "15 * * * *", "30 */3 * * *", "*/20 * * * *"]
```

을 다음으로 교체 (새 cron `"0 4 * * *"` — 매일 04:00 UTC 1회 — 을 끝에 추가):

```toml
[triggers]
crons = ["*/3 * * * *", "*/9 * * * *", "15 * * * *", "30 */3 * * *", "*/20 * * * *", "0 4 * * *"]
```

- [ ] **Step 6: `scheduled()`에 분기 추가 + 실패 알림 헬퍼**

`worker-backend/src/index.ts`의 `scheduled()` 함수 안, `if (controller.cron === "*/20 * * * *") { ... return; }` 블록 바로 뒤에 추가:

```typescript
    if (controller.cron === "0 4 * * *") {
      ctx.waitUntil(syncCityFestivalsScheduled(env));
      return;
    }
```

`syncLocalEventsScheduled` 함수 정의 바로 뒤에 새 헬퍼 함수를 추가:

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

- [ ] **Step 7: typecheck**

Run: `pnpm -C worker-backend typecheck`

Expected: 에러 없음. (`cityFestivalDiscovery.ts`가 `import type { Env } from "./index.js"`를 쓰고 `index.ts`가 `cityFestivalDiscovery.ts`를 값으로 import하는 상호 참조가 생기지만, `Env`는 타입 전용 import이므로 esbuild/tsc가 런타임 순환 없이 처리한다. 에러가 나면 `cityFestivalDiscovery.ts`의 `import type { Env } from "./index.js";`가 정말 `import type`인지 — `import { type Env }`가 아니라 — 확인한다.)

- [ ] **Step 8: 로컬 wrangler dev로 admin route 스모크 테스트**

Run: `pnpm -C worker-backend dev` (백그라운드로 띄운 뒤 별도 터미널에서)

```bash
curl -X POST -H "Authorization: Bearer <로컬 SYNC_ADMIN_TOKEN>" "http://localhost:8787/admin/sync-city-festivals"
```

Expected: `CITY_FESTIVAL_SITES`가 아직 빈 배열이므로 `{"processed":0,"published":0,"failedSites":[]}` 반환. `d1_not_configured` 또는 `unauthorized`가 나오면 로컬 `.dev.vars`에 `SYNC_ADMIN_TOKEN`과 D1 바인딩이 설정되어 있는지 확인한다 (다른 `/admin/sync-*` 라우트와 동일한 요구사항).

- [ ] **Step 9: Commit**

```bash
git add worker-backend/src/index.ts worker-backend/wrangler.toml && git commit -m "Wire city festival discovery into worker cron, admin route, and festival provider list"
```

---

## Task 11: 파일럿 사이트 실제 설정 등록 (수동 검증 필요)

**이 태스크는 이전 태스크들과 성격이 다르다.** Task 1~10은 어떤 실제 사이트 데이터도 다루지 않고 프레임워크만 구축했다 — `CITY_FESTIVAL_SITES`는 여전히 빈 배열이다. 이 태스크는 실제 시/군/구 사이트 15~20곳의 HTML을 사람 또는 브라우저/curl 접근이 가능한 agent가 직접 열어보고 정확한 CSS 셀렉터(또는 custom parser)를 확인한 뒤 등록하는 **데이터 입력 작업**이다.

이 계획을 쓰는 시점에는 각 사이트의 raw HTML을 직접 열람하지 않았으므로 셀렉터 값을 지금 확정할 수 없다 — 여기서 셀렉터를 추측해서 채우면 실제로는 아무것도 못 찾거나(빈 배열), 엉뚱한 요소를 긁어 스코어 필터를 우연히 통과하는 조용한 오류가 난다. 이는 CLAUDE.md의 "요청이 모호하면... 정말 불확실하면 추측하지 말고 보류한다" 원칙에 해당한다.

**Files:**
- Modify: `worker-backend/src/cityFestivalSites.ts` (사이트당 한 항목씩 추가)
- Modify (필요한 사이트만): `worker-backend/src/cityFestivalParsers/customParsers/index.ts` + 사이트별 custom parser 파일 (`worker-backend/src/cityFestivalParsers/customParsers/<siteId>.ts`)

- [ ] **Step 1: 사이트 후보 15~20곳 확정**

지역/카테고리 분산을 고려해 시/군/구 문화관광 페이지 목록을 정한다 (이전 세션에서 조사한 가평군, 임실군, 계룡시문화관광재단을 포함해도 된다 — 단, 이 세 곳도 아래 Step 2~4를 다시 거쳐야 한다. 이전 세션의 조사는 WebFetch로 요약된 텍스트였을 뿐, 정확한 CSS 셀렉터 확인용 raw HTML 열람이 아니었다).

- [ ] **Step 2: 각 사이트마다 robots.txt 확인**

`curl https://<사이트>/robots.txt`로 목록 페이지 경로가 `Disallow`에 걸리지 않는지 확인한다. 걸리면 그 사이트는 제외한다.

- [ ] **Step 3: 각 사이트마다 raw HTML을 직접 열어 구조 확인**

`curl -A "Mozilla/5.0 ParkingLotNavigator/1.0" <목록 URL>`로 실제 HTML을 받아 목록 아이템의 반복 구조(태그/class/id)를 확인한다. 표(`<table>`) 기반, 리스트(`<ul><li>`) 기반, 카드형 `<div>` 기반 등 구조가 사이트마다 다르다 (Task 6의 테스트 픽스처는 표 기반 예시일 뿐, 실제 사이트 구조를 대변하지 않는다). `selectors`로 표현되지 않는 사이트(JS 렌더링, 팝업/타임라인 위젯 등)는 `customParsers/<siteId>.ts`에 전용 파서를 작성하고 `CUSTOM_PARSERS`에 등록한다.

- [ ] **Step 4: 사이트 등록 + 좌표 확인**

`cityFestivalSites.ts`의 `CITY_FESTIVAL_SITES` 배열에 항목을 추가한다. `fallbackLat`/`fallbackLng`는 해당 시/군/구 시청·군청의 좌표를 쓴다. `robotsCheckedAt`에는 Step 2를 확인한 날짜(YYYY-MM-DD)를 적는다.

예시 (표 기반 사이트라고 가정 — 실제 셀렉터 값은 Step 3에서 확인한 값으로 대체):

```typescript
export const CITY_FESTIVAL_SITES: CitySiteConfig[] = [
  {
    siteId: "example-city",
    cityName: "예시시",
    listUrl: "https://example-city.go.kr/tour/festival/list.do",
    fallbackLat: 37.0,
    fallbackLng: 127.5,
    robotsCheckedAt: "2026-07-29",
    selectors: {
      itemSelector: "실제 확인한 셀렉터",
      titleSelector: "실제 확인한 셀렉터",
      dateSelector: "실제 확인한 셀렉터",
      linkSelector: "실제 확인한 셀렉터"
    }
  }
  // ... 나머지 사이트
];
```

- [ ] **Step 5: 사이트마다 typecheck + 로컬 스모크 확인**

Run: `pnpm -C worker-backend typecheck`

로컬 `wrangler dev` 기동 후:

```bash
curl -X POST -H "Authorization: Bearer <로컬 SYNC_ADMIN_TOKEN>" "http://localhost:8787/admin/sync-city-festivals"
```

Expected: `processed`가 등록한 사이트 수만큼 0보다 크게 나오고, `failedSites`가 비어있거나 실제 접속 실패한 사이트만 나열됨. `published`가 0이면 셀렉터가 실제로는 아무것도 못 찾고 있다는 뜻이므로 Step 3부터 다시 확인한다.

- [ ] **Step 6: 원격 D1 migration 적용 (아직 안 했다면) + 배포**

```bash
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0015_city_festivals.sql
pnpm -C worker-backend deploy
```

- [ ] **Step 7: 배포 후 원격 admin route로 스모크 테스트**

```bash
curl -X POST -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" "https://parking-lot-navigator-api.parkingnav.workers.dev/admin/sync-city-festivals"
```

Expected: `published` > 0. `/api/festivals?lat=...&lng=...&radiusMeters=...`로 등록한 도시 근처를 조회해 `source: "city-scraped"` 항목이 실제로 섞여 나오는지 확인한다.

- [ ] **Step 8: Commit**

```bash
git add worker-backend/src/cityFestivalSites.ts worker-backend/src/cityFestivalParsers/customParsers/ && git commit -m "Register pilot city festival site configs with verified selectors"
```

---

## Self-Review 메모

- **Spec coverage:** 설계 문서(`docs/superpowers/specs/2026-07-28-city-festival-scraper-design.md`)의 7개 컴포넌트(사이트 설정/파서/오케스트레이션/D1 테이블/캐시/provider/기존 파일 수정) 모두 Task 1~10에 매핑됨. 신뢰 점수(Task 4), 에러 처리(Task 6의 per-site try/catch + notifyOpsFailure), 테스트 전략(각 태스크의 TDD + D1 코드는 스모크 테스트), 이미지 정책(원본 URL만 저장, Task 3/7에서 다운로드 없이 문자열만 전달)까지 반영. "스코프 밖" 항목(226곳 전체 config, robots.txt 자동 검사, 관리자 UI, JS 렌더링 사이트)은 이 계획에도 포함하지 않음.
- **Placeholder scan:** 모든 코드 블록은 완전한 구현이다. 유일하게 실제 값을 채우지 않은 곳은 Task 11 — 하지만 이는 실제 사이트 raw HTML 열람이 선행되어야 하는 데이터 입력 작업이라 의도적으로 미룬 것이며, 그 이유를 태스크 본문에 명시했다(추측 방지).
- **Type consistency:** `RawCityFestivalCandidate`(Task 2) → `normalizeCandidate`가 소비(Task 3) → `NormalizedCityFestival`(Task 3) → `scoreCandidate`가 소비(Task 4) → `cityFestivalDiscovery.ts`가 셋 다 조립(Task 6) → `CityFestivalRow`(Task 7)는 D1 컬럼과 별개 타입이며 `mapCityFestivalRow`가 `Festival`로 변환 → `CityScrapedFestivalProvider`(Task 8)가 `queryCityFestivalsFromCache`를 그대로 위임. `createFestivalService(extraProviders)`(Task 9)의 시그니처와 Task 10의 호출부(`createFestivalService(env.DB ? [...] : [])`)가 일치. `Env.CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE`(Task 10)와 `cityFestivalDiscovery.ts`의 `env.CITY_FESTIVAL_AUTO_PUBLISH_MIN_SCORE` 참조(Task 6)가 일치.
