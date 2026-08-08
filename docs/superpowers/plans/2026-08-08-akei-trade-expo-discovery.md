# AKEI 산업/상업 박람회(Trade Expo) 데이터 소스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국전시산업진흥회(AKEI) 일정 게시판을 스크래핑해 코엑스·킨텍스·벡스코 등 전시컨벤션센터에서 열리는 산업/상업 박람회를 `primary_category='trade_expo'`로 새로 노출하는 festival provider를 추가한다.

**Architecture:** `worker-backend/src/akeiTradeExpoDiscovery.ts`가 `cityFestivalDiscovery.ts`와 동일한 스크래핑→D1 upsert 패턴을 따르되, 지오코딩 대신 `exhibitionVenues.ts`의 하드코딩 매핑 테이블로 좌표를 확정하고, LLM 태깅 없이 수집 시점에 `primary_category='trade_expo'`를 바로 확정한다. `akeiTradeExpoCache.ts`/`akeiTradeExpoProvider.ts`가 `cityFestivalCache.ts`/`cityScrapedFestivalProvider.ts`를 그대로 미러링해 기존 `FestivalProvider` 합성 경로(`/api/festivals`)에 합류한다. 새 cron trigger는 추가하지 않고 기존 `15 * * * *` 트리거에 `hour===5` 가드를 얹어 재사용한다. `discoveryCache.ts`의 upsert 경로가 지금까지 `primary_category`/`tagging_version`을 저장하지 않던 결함을 함께 고쳐, AKEI가 매 사이클 확정값을 D1에 실제로 반영할 수 있게 한다.

**Tech Stack:** TypeScript (Cloudflare Workers, Hono, D1, Vitest), cheerio (HTML 파싱), Swift/SwiftUI (iOS 카테고리·핀 렌더러), pnpm workspaces.

## Global Constraints

- 새 카테고리 slug: `trade_expo`, 한국어 라벨: "산업·박람회".
- `shared-types`의 `FESTIVAL_PRIMARY_CATEGORIES` 배열에서 `general_event` 다음, `etc` 이전 위치에 추가한다.
- **`worker-backend/src/llmTaggingSchema.ts`의 `FESTIVAL_PRIMARY_CATEGORIES`/`FESTIVAL_GUIDE`는 건드리지 않는다.** `trade_expo`는 LLM이 추측해서 배정하는 카테고리가 아니라 AKEI 수집 시점에 결정적으로 확정되는 값이다. 이 파일에 추가하면 LLM이 다른 소스의 일반 박람회성 행사까지 `trade_expo`로 잘못 태깅할 위험이 생긴다(`general_event`가 이미 "박람회, 엑스포, 취업박람회, 산업전, 무역전, 컨벤션"을 커버하도록 가이드에 명시돼 있다).
- AKEI 목록 페이지는 `searchYear`/`searchMonth` 쿼리 파라미터로 월 단위 필터링되므로, 스크래퍼는 매번 명시적으로 이 두 파라미터를 채워 보낸다(서버 타임존/실행 시각에 의존하는 암묵적 "현재 월" 기본값에 의존하지 않는다).
- 전시장 좌표는 지오코딩 API를 호출하지 않고 `worker-backend/src/exhibitionVenues.ts`의 하드코딩 테이블로만 해석한다. 매핑에 없는 전시장명은 그 행을 skip하고 `console.warn`으로 로그만 남긴다.
- Cloudflare Workers 계정은 스크립트당 cron trigger 5개 한도이며 현재 정확히 5개가 사용 중이다(`*/3 * * * *`, `*/9 * * * *`, `15 * * * *`, `30 */3 * * *`, `*/20 * * * *`). 새 cron을 추가하지 않고 `15 * * * *` 안에 `scheduledAt.getUTCHours() === 5` 가드를 추가해 하루 1회 재사용한다.
- iOS `CURRENT_PROJECT_VERSION`은 197 → 198로 정확히 1 증가시킨다 (`ios-app/project.yml:21`).
- Worker 변경 검증 최소 기준: `pnpm -C worker-backend typecheck` && `pnpm -C worker-backend test`.
- 이 작업은 로컬 매장 이벤트(`LocalEventPrimaryCategory`, `local_events` 테이블) 도메인을 건드리지 않는다.
- 1차 구현 범위는 목록 페이지 필드(제목/주최/기간/전시장명)만 사용한다. 상세 페이지 크롤링(홈페이지 링크, 세부품목)과 이미지 추출(관측 샘플이 전부 `no_img.png` placeholder)은 범위 밖이다.

---

### Task 1: D1 마이그레이션 — `akei_trade_expos` 테이블

**Files:**
- Create: `worker-backend/migrations/0016_akei_trade_expos.sql`

**Interfaces:**
- Produces: `akei_trade_expos` 테이블 (컬럼: `id, source_url, title, organizer, start_date, end_date, venue, address, lat, lng, image_url, scraped_at`) — Task 4(스크래퍼)와 Task 5(캐시 조회)가 이 스키마를 그대로 소비한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`worker-backend/migrations/0016_akei_trade_expos.sql`:

```sql
CREATE TABLE akei_trade_expos (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  organizer TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  venue TEXT,
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  image_url TEXT,
  scraped_at TEXT NOT NULL
);

CREATE INDEX idx_akei_trade_expos_lat_lng ON akei_trade_expos(lat, lng);
```

- [ ] **Step 2: 로컬 D1에 적용해 문법 검증**

Run: `pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --local --file ./migrations/0016_akei_trade_expos.sql`
Expected: PASS (에러 없이 적용됨). remote 적용은 이 plan의 실행이 아니라 배포 단계에서 별도로 수행한다.

- [ ] **Step 3: 커밋**

```bash
git add worker-backend/migrations/0016_akei_trade_expos.sql
git commit -m "Add akei_trade_expos D1 table for AKEI trade expo scraper"
```

---

### Task 2: shared-types에 `trade_expo` 카테고리 추가

**Files:**
- Modify: `shared-types/src/discover.ts:29-42`

**Interfaces:**
- Produces: `FESTIVAL_PRIMARY_CATEGORIES` 배열에 `"trade_expo"` 포함 → `FestivalPrimaryCategory` 유니온 타입에 `"trade_expo"` 추가 (Task 5, 10, 11이 이 타입을 참조).

- [ ] **Step 1: `FESTIVAL_PRIMARY_CATEGORIES` 배열 수정**

`shared-types/src/discover.ts`의 다음 블록을:

```ts
export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "general_event",
  "etc",
] as const;
```

다음으로 교체한다 (`general_event`와 `etc` 사이에 `trade_expo` 삽입):

```ts
export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "general_event",
  "trade_expo",
  "etc",
] as const;
```

- [ ] **Step 2: 타입체크로 컴파일 확인**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add shared-types/src/discover.ts && git commit -m "Add trade_expo to FestivalPrimaryCategory"
```

---

### Task 3: 전시장 좌표 하드코딩 매핑 (`exhibitionVenues.ts`)

**Files:**
- Create: `worker-backend/src/exhibitionVenues.ts`
- Test: `worker-backend/tests/exhibitionVenues.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수, 외부 의존성 없음).
- Produces: `export interface ExhibitionVenue { lat: number; lng: number; address: string }`, `export function resolveExhibitionVenue(venueText: string): ExhibitionVenue | null` — Task 4의 파서가 추출한 전시장명 텍스트를 이 함수에 넘긴다.

**중요 — 좌표 검증 필요:** 아래 좌표값은 학습 데이터 기반 근사치이며, 이번 세션에서 실시간 지도 서비스로 직접 조회/검증하지 않았다. 구현자는 머지/배포 전 반드시 Kakao Map 또는 Google Maps에서 각 전시장의 정확한 좌표를 재확인하고 필요시 값을 교정해야 한다. 좌표가 틀리면 지도 핀이 실제와 다른 위치에 찍히는 사용자 눈에 바로 보이는 오류가 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/exhibitionVenues.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveExhibitionVenue } from "../src/exhibitionVenues.js";

describe("resolveExhibitionVenue", () => {
  it("matches an exact Korean venue name", () => {
    const venue = resolveExhibitionVenue("코엑스");
    expect(venue).not.toBeNull();
    expect(venue?.lat).toBeCloseTo(37.512627, 3);
    expect(venue?.lng).toBeCloseTo(127.058678, 3);
  });

  it("matches an exact English alias", () => {
    const venue = resolveExhibitionVenue("COEX");
    expect(venue).not.toBeNull();
    expect(venue?.address).toBe("서울 강남구 영동대로 513");
  });

  it("matches by substring when the raw text has a parenthetical qualifier", () => {
    const venue = resolveExhibitionVenue("코엑스(COEX)");
    expect(venue).not.toBeNull();
    expect(venue?.lat).toBeCloseTo(37.512627, 3);
  });

  it("matches a real AKEI venue text with an English suffix", () => {
    const venue = resolveExhibitionVenue("송도컨벤시아(Songdo ConvensiA)");
    expect(venue).not.toBeNull();
    expect(venue?.address).toBe("인천 연수구 센트럴로 123");
  });

  it("returns null for an unmapped venue name", () => {
    expect(resolveExhibitionVenue("듣도보도못한전시장")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveExhibitionVenue("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `pnpm --filter @parking/backend exec vitest run exhibitionVenues.test.ts` (또는 `pnpm -C worker-backend exec vitest run exhibitionVenues.test.ts` — worker-backend가 vitest를 직접 실행하는 워크스페이스라면 이쪽)
Expected: FAIL — `Cannot find module '../src/exhibitionVenues.js'`

- [ ] **Step 3: `exhibitionVenues.ts` 구현**

`worker-backend/src/exhibitionVenues.ts`:

```ts
export interface ExhibitionVenue {
  lat: number;
  lng: number;
  address: string;
}

// 좌표는 학습 데이터 기반 근사치 — 배포 전 Kakao/Google Maps로 재검증할 것.
export const EXHIBITION_VENUES: Record<string, ExhibitionVenue> = {
  "코엑스": { lat: 37.512627, lng: 127.058678, address: "서울 강남구 영동대로 513" },
  "COEX": { lat: 37.512627, lng: 127.058678, address: "서울 강남구 영동대로 513" },
  "킨텍스": { lat: 37.668078, lng: 126.744528, address: "경기 고양시 일산서구 킨텍스로 217-6" },
  "KINTEX": { lat: 37.668078, lng: 126.744528, address: "경기 고양시 일산서구 킨텍스로 217-6" },
  "벡스코": { lat: 35.169275, lng: 129.13605, address: "부산 해운대구 APEC로 55" },
  "BEXCO": { lat: 35.169275, lng: 129.13605, address: "부산 해운대구 APEC로 55" },
  "송도컨벤시아": { lat: 37.39018, lng: 126.657367, address: "인천 연수구 센트럴로 123" },
  "Songdo ConvensiA": { lat: 37.39018, lng: 126.657367, address: "인천 연수구 센트럴로 123" },
  "aT센터": { lat: 37.4709, lng: 127.0378, address: "서울 서초구 강남대로 27" },
  "SETEC": { lat: 37.478, lng: 127.0653, address: "서울 강남구 남부순환로 3104" },
  "EXCO": { lat: 35.89231, lng: 128.62278, address: "대구 북구 엑스코로 10" },
  "엑스코": { lat: 35.89231, lng: 128.62278, address: "대구 북구 엑스코로 10" },
};

export function resolveExhibitionVenue(venueText: string): ExhibitionVenue | null {
  const trimmed = venueText.trim();
  if (!trimmed) return null;

  const exact = EXHIBITION_VENUES[trimmed];
  if (exact) return exact;

  for (const [key, venue] of Object.entries(EXHIBITION_VENUES)) {
    if (trimmed.includes(key)) return venue;
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm -C worker-backend exec vitest run exhibitionVenues.test.ts`
Expected: PASS (6개 테스트 모두)

- [ ] **Step 5: 커밋**

```bash
git add worker-backend/src/exhibitionVenues.ts worker-backend/tests/exhibitionVenues.test.ts && git commit -m "Add hardcoded exhibition venue coordinate lookup"
```

---

### Task 4: AKEI 목록 페이지 파서 + discovery 오케스트레이션

**Files:**
- Create: `worker-backend/src/akeiTradeExpoDiscovery.ts`
- Test: `worker-backend/tests/akeiTradeExpoDiscovery.test.ts`

**Interfaces:**
- Consumes: `resolveExhibitionVenue` from `./exhibitionVenues.js` (Task 3), `fetchWithTimeout` from `../../backend/src/features/discover/events/eventProviderUtils.js` (기존 코드, `cityFestivalDiscovery.ts`가 이미 같은 방식으로 사용 중).
- Produces:
  - `export interface AkeiRawCandidate { wrId: string; title: string; organizer: string | null; startDate: string; endDate: string; venueText: string; sourceUrl: string }`
  - `export function parseAkeiListPage(html: string): AkeiRawCandidate[]`
  - `export interface AkeiTradeExpoDiscoveryResult { processed: number; published: number; failedMonths: string[]; unmappedVenues: number }`
  - `export async function runAkeiTradeExpoDiscovery(db: D1Database, referenceDate?: Date): Promise<AkeiTradeExpoDiscoveryResult>` — Task 9(index.ts)가 이 함수를 cron/admin 라우트에서 호출한다.

**AKEI 목록 페이지 실제 HTML 구조** (2026-08-08에 `https://www.akei.or.kr/bbs/board.php?bo_table=schedule`을 직접 fetch해 확인한 실제 응답 발췌):

```html
<div class="exhibit_list">
    <ul>
        <li class="content_sc_li" id="content_sc_104847">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104847" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;키워 특수동물 EXPO with 크리에이터 기획전 정브르 x 헌터퐝                </p></strong>
                    <ul>
                        <li>주 최 : 주식회사 키워, 주식회사 헌터퐝</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 송도컨벤시아(Songdo ConvensiA)</li>
                    </ul>
                </a>
            </div><!-- txt -->
            ...
        </li>
        <li class="content_sc_li" id="content_sc_104910">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104910" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;제424회 웨덱스 웨딩박람회                </p></strong>
                    <ul>
                        <li>주 최 : ㈜웨덱스웨딩</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 코엑스(COEX)</li>
                    </ul>
                </a>
            </div><!-- txt -->
            ...
        </li>
    </ul>
</div>
```

목록 페이지 요약 블록(`<div class="txt"><ul><li>...</li></ul>`)에 제목/주최/기간/전시장명이 모두 이미 들어있으므로 확장 상세 `<table>`은 파싱하지 않는다. 기간 표기는 공백 없이 `~`로만 이어진다(`2026-08-01~2026-08-02`). 제목은 `&nbsp;`(U+00A0)로 시작하고 앞뒤에 공백/개행이 섞여 있는데, JS의 `String.prototype.trim()`은 U+00A0을 포함한 WhiteSpace production을 전부 제거하므로 `.trim()` 한 번으로 깔끔한 제목이 나온다.

- [ ] **Step 1: 파서 실패하는 테스트 작성**

`worker-backend/tests/akeiTradeExpoDiscovery.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAkeiListPage, runAkeiTradeExpoDiscovery } from "../src/akeiTradeExpoDiscovery.js";

// AKEI 목록 페이지에서 2026-08-08에 직접 fetch로 확인한 실제 응답을 축약한 픽스처.
// 상세 <table> 블록은 파서가 쓰지 않으므로 생략했다.
const AKEI_LIST_FIXTURE_TWO_ITEMS = `
<div class="exhibit_list">
    <ul>
        <li class="content_sc_li" id="content_sc_104847">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104847" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;키워 특수동물 EXPO with 크리에이터 기획전 정브르 x 헌터퐝                </p></strong>
                    <ul>
                        <li>주 최 : 주식회사 키워, 주식회사 헌터퐝</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 송도컨벤시아(Songdo ConvensiA)</li>
                    </ul>
                </a>
            </div>
        </li>
        <li class="content_sc_li" id="content_sc_104910">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104910" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;제424회 웨덱스 웨딩박람회                </p></strong>
                    <ul>
                        <li>주 최 : ㈜웨덱스웨딩</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 코엑스(COEX)</li>
                    </ul>
                </a>
            </div>
        </li>
    </ul>
</div>
`;

const AKEI_LIST_FIXTURE_EMPTY = `<div class="exhibit_list"><ul></ul></div>`;

describe("parseAkeiListPage", () => {
  it("extracts wrId, title, organizer, dates, and venue from real list markup", () => {
    const candidates = parseAkeiListPage(AKEI_LIST_FIXTURE_TWO_ITEMS);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      wrId: "104847",
      title: "키워 특수동물 EXPO with 크리에이터 기획전 정브르 x 헌터퐝",
      organizer: "주식회사 키워, 주식회사 헌터퐝",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      venueText: "송도컨벤시아(Songdo ConvensiA)",
      sourceUrl: "https://www.akei.or.kr/bbs/board.php?bo_table=schedule&wr_id=104847",
    });
    expect(candidates[1].wrId).toBe("104910");
    expect(candidates[1].venueText).toBe("코엑스(COEX)");
  });

  it("returns an empty array when the page has no rows", () => {
    expect(parseAkeiListPage(AKEI_LIST_FIXTURE_EMPTY)).toEqual([]);
  });
});

function fakeDb(): { db: D1Database; batch: ReturnType<typeof vi.fn> } {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: () => ({ bind: () => ({}) }),
    batch,
  } as unknown as D1Database;
  return { db, batch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAkeiTradeExpoDiscovery", () => {
  it("processes the first page's candidate, resolves its venue, and upserts it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(AKEI_LIST_FIXTURE_TWO_ITEMS, { status: 200 }))
      .mockResolvedValue(new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, batch } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.processed).toBe(2);
    expect(result.published).toBe(2);
    expect(result.unmappedVenues).toBe(0);
    expect(result.failedMonths).toEqual([]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });

  it("skips a candidate whose venue text has no coordinate mapping", async () => {
    const unmappedFixture = AKEI_LIST_FIXTURE_TWO_ITEMS.replace(
      "코엑스(COEX)",
      "듣도보도못한전시장",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(unmappedFixture, { status: 200 }))
      .mockResolvedValue(new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, batch } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.processed).toBe(2);
    expect(result.published).toBe(1);
    expect(result.unmappedVenues).toBe(1);
    expect(batch.mock.calls[0][0]).toHaveLength(1);
  });

  it("records a failing month in failedMonths and still processes later months", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.failedMonths).toEqual(["2026-08"]);
    expect(result.processed).toBe(0);
  });

  it("treats a non-ok HTTP response as a page fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { db } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.failedMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("stops paginating a month once a page returns zero rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(AKEI_LIST_FIXTURE_TWO_ITEMS, { status: 200 }))
      .mockResolvedValue(new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();

    await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    // month0: page1(2 items) + page2(empty, stop) = 2 calls; month1: page1(empty) = 1 call; month2: page1(empty) = 1 call
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `pnpm -C worker-backend exec vitest run akeiTradeExpoDiscovery.test.ts`
Expected: FAIL — `Cannot find module '../src/akeiTradeExpoDiscovery.js'`

- [ ] **Step 3: `akeiTradeExpoDiscovery.ts` 구현**

`worker-backend/src/akeiTradeExpoDiscovery.ts`:

```ts
import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import { resolveExhibitionVenue } from "./exhibitionVenues.js";

const AKEI_BASE_URL = "https://www.akei.or.kr";
const AKEI_MONTHS_AHEAD = 3;
const AKEI_MAX_PAGES_PER_MONTH = 10;
const AKEI_FETCH_TIMEOUT_MS = 20000;
const AKEI_FETCH_RETRY_DELAY_MS = 500;
const AKEI_PAGE_DELAY_MS = 300;

export interface AkeiRawCandidate {
  wrId: string;
  title: string;
  organizer: string | null;
  startDate: string;
  endDate: string;
  venueText: string;
  sourceUrl: string;
}

export function parseAkeiListPage(html: string): AkeiRawCandidate[] {
  const $ = cheerio.load(html);
  const candidates: AkeiRawCandidate[] = [];

  $("li.content_sc_li").each((_, el) => {
    const $el = $(el);
    const wrId = ($el.attr("id") ?? "").replace("content_sc_", "").trim();
    if (!wrId) return;

    const title = $el.find(".txt strong p").first().text().trim();
    if (!title) return;

    const summaryLines = $el
      .find(".txt ul li")
      .map((_, li) => $(li).text().trim())
      .get();

    const organizerLine = summaryLines.find((line) => /^주\s*최\s*:/.test(line));
    const periodLine = summaryLines.find((line) => /^기\s*간\s*:/.test(line));
    const venueLine = summaryLines.find((line) => /^장\s*소\s*:/.test(line));
    if (!periodLine || !venueLine) return;

    const periodMatch = periodLine.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
    if (!periodMatch) return;

    candidates.push({
      wrId,
      title,
      organizer: organizerLine ? organizerLine.replace(/^[^:]*:\s*/, "") : null,
      startDate: periodMatch[1],
      endDate: periodMatch[2],
      venueText: venueLine.replace(/^[^:]*:\s*/, ""),
      sourceUrl: `${AKEI_BASE_URL}/bbs/board.php?bo_table=schedule&wr_id=${wrId}`,
    });
  });

  return candidates;
}

export interface AkeiTradeExpoDiscoveryResult {
  processed: number;
  published: number;
  failedMonths: string[];
  unmappedVenues: number;
}

export async function runAkeiTradeExpoDiscovery(
  db: D1Database,
  referenceDate: Date = new Date(),
): Promise<AkeiTradeExpoDiscoveryResult> {
  let processed = 0;
  let published = 0;
  let unmappedVenues = 0;
  const failedMonths: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const seenIds = new Set<string>();
  const scrapedAt = new Date().toISOString();

  for (let offset = 0; offset < AKEI_MONTHS_AHEAD; offset++) {
    const target = new Date(
      Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + offset, 1),
    );
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

    let page = 1;
    let monthFailed = false;
    while (page <= AKEI_MAX_PAGES_PER_MONTH) {
      const url = `${AKEI_BASE_URL}/bbs/board.php?bo_table=schedule&searchYear=${year}&searchMonth=${String(month).padStart(2, "0")}&page=${page}`;
      const fetched = await fetchAkeiPage(url);
      if ("error" in fetched) {
        console.error(`akei trade expo discovery failed for month=${monthLabel} page=${page}`, fetched.error);
        monthFailed = true;
        break;
      }

      const candidates = parseAkeiListPage(fetched.html);
      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        const id = `akei:${candidate.wrId}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        processed += 1;

        const venue = resolveExhibitionVenue(candidate.venueText);
        if (!venue) {
          unmappedVenues += 1;
          console.warn(`akei trade expo unmapped venue: ${candidate.venueText}`);
          continue;
        }

        statements.push(buildUpsertStatement(db, candidate, venue, scrapedAt));
        published += 1;
      }

      page += 1;
      await delay(AKEI_PAGE_DELAY_MS);
    }
    if (monthFailed) failedMonths.push(monthLabel);
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return { processed, published, failedMonths, unmappedVenues };
}

async function fetchAkeiPage(url: string): Promise<{ html: string } | { error: Error }> {
  const attempts = 2;
  let lastError: Error = new Error("unreachable");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(
        new URL(url),
        { headers: { "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0" } },
        AKEI_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`akei trade expo page fetch failed: ${response.status}`);
      }
      return { html: await response.text() };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) await delay(AKEI_FETCH_RETRY_DELAY_MS);
    }
  }
  return { error: lastError };
}

function buildUpsertStatement(
  db: D1Database,
  candidate: AkeiRawCandidate,
  venue: { lat: number; lng: number; address: string },
  scrapedAt: string,
): D1PreparedStatement {
  const id = `akei:${candidate.wrId}`;
  return db
    .prepare(
      `INSERT INTO akei_trade_expos (
        id, source_url, title, organizer, start_date, end_date, venue, address, lat, lng, image_url, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        organizer = excluded.organizer,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        venue = excluded.venue,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        image_url = excluded.image_url,
        scraped_at = excluded.scraped_at`,
    )
    .bind(
      id,
      candidate.sourceUrl,
      candidate.title,
      candidate.organizer,
      candidate.startDate,
      candidate.endDate,
      candidate.venueText,
      venue.address,
      venue.lat,
      venue.lng,
      null,
      scrapedAt,
    );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm -C worker-backend exec vitest run akeiTradeExpoDiscovery.test.ts`
Expected: PASS (7개 테스트 모두)

- [ ] **Step 5: 타입체크**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add worker-backend/src/akeiTradeExpoDiscovery.ts worker-backend/tests/akeiTradeExpoDiscovery.test.ts && git commit -m "Add AKEI trade expo scraper with multi-month pagination"
```

---

### Task 5: 조회 캐시 (`akeiTradeExpoCache.ts`)

**Files:**
- Create: `worker-backend/src/akeiTradeExpoCache.ts`
- Test: `worker-backend/tests/akeiTradeExpoCache.test.ts`

**Interfaces:**
- Consumes: `akei_trade_expos` 테이블 (Task 1), `Festival` type from `@parking/shared-types` (Task 2가 `trade_expo`를 추가한 뒤의 타입).
- Produces: `export interface AkeiTradeExpoRow { id, source_url, title, organizer, start_date, end_date, venue, address, lat, lng, image_url }`, `export function mapAkeiTradeExpoRow(row: AkeiTradeExpoRow, lat: number, lng: number): Festival | null`, `export async function queryAkeiTradeExposFromCache(db, lat, lng, radiusMeters, upcomingWithinDays): Promise<Festival[]>` — Task 6(provider)이 이 조회 함수를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/akeiTradeExpoCache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapAkeiTradeExpoRow } from "../src/akeiTradeExpoCache.js";

describe("mapAkeiTradeExpoRow", () => {
  const baseRow = {
    id: "akei:104910",
    source_url: "https://www.akei.or.kr/bbs/board.php?bo_table=schedule&wr_id=104910",
    title: "제424회 웨덱스 웨딩박람회",
    organizer: "㈜웨덱스웨딩",
    start_date: "2026-08-01",
    end_date: "2026-08-02",
    venue: "코엑스(COEX)",
    address: "서울 강남구 영동대로 513",
    lat: 37.512627,
    lng: 127.058678,
    image_url: null,
  };

  it("maps a valid row to a Festival with source=akei-trade-expo and primaryCategory=trade_expo", () => {
    const result = mapAkeiTradeExpoRow(baseRow, 37.512627, 127.058678);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("akei-trade-expo");
    expect(result?.primaryCategory).toBe("trade_expo");
    expect(result?.title).toBe("제424회 웨덱스 웨딩박람회");
    expect(result?.organizerName).toBe("㈜웨덱스웨딩");
    expect(result?.distanceMeters).toBe(0);
  });

  it("returns null when the row has no id", () => {
    expect(mapAkeiTradeExpoRow({ ...baseRow, id: "" }, 37.5, 127.0)).toBeNull();
  });

  it("returns null when lat/lng are not finite numbers", () => {
    expect(mapAkeiTradeExpoRow({ ...baseRow, lat: NaN }, 37.5, 127.0)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `pnpm -C worker-backend exec vitest run akeiTradeExpoCache.test.ts`
Expected: FAIL — `Cannot find module '../src/akeiTradeExpoCache.js'`

- [ ] **Step 3: `akeiTradeExpoCache.ts` 구현**

`worker-backend/src/akeiTradeExpoCache.ts`:

```ts
import type { Festival } from "@parking/shared-types";
import { distanceMeters } from "../../backend/src/services/geo.js";
import { discoverStatus, isWithinWindow } from "../../backend/src/features/discover/common/dateUtils.js";

const AKEI_TRADE_EXPO_RESULT_LIMIT = 500;
const AKEI_TRADE_EXPO_PREFETCH_LIMIT = 2000;

export interface AkeiTradeExpoRow {
  id: string;
  source_url: string;
  title: string;
  organizer: string | null;
  start_date: string;
  end_date: string;
  venue: string | null;
  address: string | null;
  lat: number;
  lng: number;
  image_url: string | null;
}

export async function queryAkeiTradeExposFromCache(
  db: D1Database,
  lat: number,
  lng: number,
  radiusMeters: number,
  upcomingWithinDays: number,
): Promise<Festival[]> {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / Math.max(40000, 111320 * Math.cos((lat * Math.PI) / 180));
  const rows = await db
    .prepare(
      `SELECT id, source_url, title, organizer, start_date, end_date, venue, address, lat, lng, image_url
         FROM akei_trade_expos
        WHERE lat BETWEEN ? AND ?
          AND lng BETWEEN ? AND ?
        ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?)) ASC
        LIMIT ?`,
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
      AKEI_TRADE_EXPO_PREFETCH_LIMIT,
    )
    .all<AkeiTradeExpoRow>();

  return (rows.results ?? [])
    .map((row) => mapAkeiTradeExpoRow(row, lat, lng))
    .filter((item): item is Festival => item !== null)
    .filter((item) => item.distanceMeters <= radiusMeters)
    .filter((item) => isWithinWindow(item.startDate, item.endDate, upcomingWithinDays))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, AKEI_TRADE_EXPO_RESULT_LIMIT);
}

export function mapAkeiTradeExpoRow(row: AkeiTradeExpoRow, lat: number, lng: number): Festival | null {
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
    source: "akei-trade-expo",
    sourceUrl: row.source_url,
    imageUrl: row.image_url,
    tags: [],
    primaryCategory: "trade_expo",
    organizerName: row.organizer,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm -C worker-backend exec vitest run akeiTradeExpoCache.test.ts`
Expected: PASS (3개 테스트 모두)

- [ ] **Step 5: 커밋**

```bash
git add worker-backend/src/akeiTradeExpoCache.ts worker-backend/tests/akeiTradeExpoCache.test.ts && git commit -m "Add AKEI trade expo cache query with primaryCategory=trade_expo"
```

---

### Task 6: `AkeiTradeExpoFestivalProvider`

**Files:**
- Create: `worker-backend/src/akeiTradeExpoProvider.ts`

**Interfaces:**
- Consumes: `queryAkeiTradeExposFromCache` from `./akeiTradeExpoCache.js` (Task 5), `BaseProviderHealth` from `../../backend/src/providers/BaseProviderHealth.js`, `DiscoverQuery`/`FestivalProvider` from `../../backend/src/features/discover/common/discoverProvider.js` (기존 코드).
- Produces: `export class AkeiTradeExpoFestivalProvider extends BaseProviderHealth implements FestivalProvider` — Task 9(index.ts)가 `new AkeiTradeExpoFestivalProvider(env.DB)`로 인스턴스화해 `createFestivalService(providers)` 배열에 추가한다.

이 파일은 순수 위임 클래스라 별도 테스트 파일을 만들지 않는다(`CityScrapedFestivalProvider`도 동일하게 전용 테스트가 없다) — provider의 동작은 Task 5의 `akeiTradeExpoCache.test.ts`가 이미 커버한다.

- [ ] **Step 1: `akeiTradeExpoProvider.ts` 구현**

`worker-backend/src/akeiTradeExpoProvider.ts`:

```ts
import type { Festival } from "@parking/shared-types";
import { BaseProviderHealth } from "../../backend/src/providers/BaseProviderHealth.js";
import type { DiscoverQuery, FestivalProvider } from "../../backend/src/features/discover/common/discoverProvider.js";
import { queryAkeiTradeExposFromCache } from "./akeiTradeExpoCache.js";

export class AkeiTradeExpoFestivalProvider extends BaseProviderHealth implements FestivalProvider {
  constructor(private readonly db: D1Database) {
    super("akei-trade-expo");
  }

  async festivals(query: DiscoverQuery): Promise<Festival[]> {
    try {
      const items = await queryAkeiTradeExposFromCache(
        this.db,
        query.lat,
        query.lng,
        query.radiusMeters,
        query.upcomingWithinDays,
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

- [ ] **Step 2: 타입체크**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add worker-backend/src/akeiTradeExpoProvider.ts && git commit -m "Add AkeiTradeExpoFestivalProvider"
```

---

### Task 7: `discoveryCache.ts` — `primary_category`/`tagging_version` 영속화 수정

**Files:**
- Modify: `worker-backend/src/discoveryCache.ts:1` (import 추가), `:130-158` (`DiscoveryRowPayload`), `:528-605` (`DISCOVERY_UPSERT_SQL`/`prepareDiscoveryUpsert`), `:683-721` (`discoveryRow`)
- Test: `worker-backend/tests/discoveryRow.test.ts`

**배경:** 지금까지 `DISCOVERY_UPSERT_SQL`의 INSERT/UPDATE 절에 `primary_category`/`tagging_version` 컬럼이 빠져 있었다. 이 두 컬럼은 오직 `llmTagging.ts`의 별도 `UPDATE discovery_items SET primary_category = ?, ... WHERE ...` 문으로만 채워졌다(이 sync-upsert 경로와 무관하게 동작). AKEI 스크래퍼는 매 사이클 `discoveryRow()`를 거쳐 upsert되므로, 이 결함을 고치지 않으면 AKEI가 애써 확정한 `primary_category='trade_expo'`가 매번 사라진다.

`tagging_version` 컬럼은 D1 스키마에서 `INTEGER NOT NULL DEFAULT 0`이다(`worker-backend/migrations/0011_discovery_tagging.sql:3`). INSERT 문에 이 컬럼을 명시적으로 포함하면서 `null`을 bind하면 SQLite는 컬럼 기본값을 적용하지 않고 그대로 NOT NULL 제약을 위반해 실패한다 — 그래서 `taggingVersion`은 항상 숫자(`TAGGING_VERSION` 또는 `0`)를 bind해야 한다.

**Interfaces:**
- Consumes: `TAGGING_VERSION` from `./llmTaggingSchema.js` (기존 export, 값 `1`).
- Produces: `export function discoveryRow(item: DiscoveryItem, syncedAt: string): DiscoveryRowPayload`, `export function prepareDiscoveryUpsert(db: D1Database, item: DiscoveryItem, syncedAt: string): D1PreparedStatement` (기존 private 함수를 export로 전환) — 이 테스트가 직접 이 두 함수를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`worker-backend/tests/discoveryRow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { discoveryRow, prepareDiscoveryUpsert } from "../src/discoveryCache.js";
import type { Festival } from "@parking/shared-types";

const baseFestival: Festival = {
  id: "akei:104910",
  title: "제424회 웨덱스 웨딩박람회",
  subtitle: null,
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  status: "upcoming",
  venueName: "코엑스",
  address: "서울 강남구 영동대로 513",
  lat: 37.512627,
  lng: 127.058678,
  distanceMeters: 0,
  source: "akei-trade-expo",
  sourceUrl: "https://www.akei.or.kr/bbs/board.php?bo_table=schedule&wr_id=104910",
  imageUrl: null,
  tags: [],
  primaryCategory: "trade_expo",
};

describe("discoveryRow", () => {
  it("carries an in-memory primaryCategory through to the row payload with TAGGING_VERSION", () => {
    const row = discoveryRow(baseFestival, "2026-08-08T00:00:00.000Z");
    expect(row.primaryCategory).toBe("trade_expo");
    expect(row.taggingVersion).toBe(1);
  });

  it("defaults to null primaryCategory and tagging_version=0 when the item has none set", () => {
    const row = discoveryRow({ ...baseFestival, primaryCategory: undefined }, "2026-08-08T00:00:00.000Z");
    expect(row.primaryCategory).toBeNull();
    expect(row.taggingVersion).toBe(0);
  });
});

describe("prepareDiscoveryUpsert", () => {
  it("binds primaryCategory and taggingVersion as part of the upsert statement", () => {
    const bindCalls: unknown[][] = [];
    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          bindCalls.push(args);
          return {};
        },
      }),
    } as unknown as D1Database;

    prepareDiscoveryUpsert(db, baseFestival, "2026-08-08T00:00:00.000Z");

    expect(bindCalls).toHaveLength(1);
    expect(bindCalls[0]).toContain("trade_expo");
    expect(bindCalls[0]).toContain(1);
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `pnpm -C worker-backend exec vitest run discoveryRow.test.ts`
Expected: FAIL — `discoveryRow`/`prepareDiscoveryUpsert` are not exported from `../src/discoveryCache.js`

- [ ] **Step 3: import 추가**

`worker-backend/src/discoveryCache.ts:1` 부근(파일 상단 import 블록)에 추가:

```ts
import { TAGGING_VERSION } from "./llmTaggingSchema.js";
```

- [ ] **Step 4: `DiscoveryRowPayload`에 필드 추가**

`worker-backend/src/discoveryCache.ts:130-158`의 현재 블록:

```ts
interface DiscoveryRowPayload {
  id: string;
  type: "festival";
  source: string;
  sourceItemId: string;
  title: string;
  subtitle: string | null;
  categoryText: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "ongoing" | "upcoming" | null;
  isFree: number | null;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  lowestPriceText: string | null;
  lowestPricePlatform: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  imagesJson: string | null;
  tagsJson: string | null;
  amenitiesJson: string | null;
  offersJson: string | null;
  rawPayload: string;
  dataUpdatedAt: string;
}
```

다음으로 교체 (`dataUpdatedAt` 다음에 두 필드 추가):

```ts
interface DiscoveryRowPayload {
  id: string;
  type: "festival";
  source: string;
  sourceItemId: string;
  title: string;
  subtitle: string | null;
  categoryText: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "ongoing" | "upcoming" | null;
  isFree: number | null;
  venueName: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number | null;
  lowestPriceText: string | null;
  lowestPricePlatform: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  imagesJson: string | null;
  tagsJson: string | null;
  amenitiesJson: string | null;
  offersJson: string | null;
  rawPayload: string;
  dataUpdatedAt: string;
  primaryCategory: string | null;
  taggingVersion: number;
}
```

- [ ] **Step 5: `DISCOVERY_UPSERT_SQL`과 `prepareDiscoveryUpsert` 수정**

`worker-backend/src/discoveryCache.ts:528-605`의 현재 블록 전체를:

```ts
const DISCOVERY_UPSERT_SQL = `INSERT INTO discovery_items (
        id, type, source, source_item_id, title, subtitle, category_text,
        start_date, end_date, status, is_free, venue_name, address, lat, lng,
        rating, review_count, lowest_price_text, lowest_price_platform,
        source_url, image_url, images_json, tags_json, amenities_json, offers_json, raw_payload,
        data_updated_at, first_seen_at, last_seen_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        source = excluded.source,
        source_item_id = excluded.source_item_id,
        title = excluded.title,
        subtitle = excluded.subtitle,
        category_text = excluded.category_text,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        is_free = excluded.is_free,
        venue_name = excluded.venue_name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        rating = excluded.rating,
        review_count = excluded.review_count,
        lowest_price_text = excluded.lowest_price_text,
        lowest_price_platform = excluded.lowest_price_platform,
        source_url = excluded.source_url,
        image_url = COALESCE(NULLIF(excluded.image_url, ''), NULLIF(image_url, '')),
        images_json = COALESCE(NULLIF(excluded.images_json, ''), NULLIF(images_json, '')),
        tags_json = excluded.tags_json,
        amenities_json = excluded.amenities_json,
        offers_json = excluded.offers_json,
        raw_payload = excluded.raw_payload,
        data_updated_at = excluded.data_updated_at,
        last_seen_at = excluded.last_seen_at,
        synced_at = excluded.synced_at`;

function prepareDiscoveryUpsert(
  db: D1Database,
  item: DiscoveryItem,
  syncedAt: string,
): D1PreparedStatement {
  const row = discoveryRow(item, syncedAt);
  return db
    .prepare(DISCOVERY_UPSERT_SQL)
    .bind(
      row.id,
      row.type,
      row.source,
      row.sourceItemId,
      row.title,
      row.subtitle,
      row.categoryText,
      row.startDate,
      row.endDate,
      row.status,
      row.isFree,
      row.venueName,
      row.address,
      row.lat,
      row.lng,
      row.rating,
      row.reviewCount,
      row.lowestPriceText,
      row.lowestPricePlatform,
      row.sourceUrl,
      row.imageUrl,
      row.imagesJson,
      row.tagsJson,
      row.amenitiesJson,
      row.offersJson,
      row.rawPayload,
      row.dataUpdatedAt,
      syncedAt,
      syncedAt,
      syncedAt,
    );
}
```

다음으로 교체:

```ts
const DISCOVERY_UPSERT_SQL = `INSERT INTO discovery_items (
        id, type, source, source_item_id, title, subtitle, category_text,
        start_date, end_date, status, is_free, venue_name, address, lat, lng,
        rating, review_count, lowest_price_text, lowest_price_platform,
        source_url, image_url, images_json, tags_json, amenities_json, offers_json, raw_payload,
        data_updated_at, primary_category, tagging_version, first_seen_at, last_seen_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        source = excluded.source,
        source_item_id = excluded.source_item_id,
        title = excluded.title,
        subtitle = excluded.subtitle,
        category_text = excluded.category_text,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        is_free = excluded.is_free,
        venue_name = excluded.venue_name,
        address = excluded.address,
        lat = excluded.lat,
        lng = excluded.lng,
        rating = excluded.rating,
        review_count = excluded.review_count,
        lowest_price_text = excluded.lowest_price_text,
        lowest_price_platform = excluded.lowest_price_platform,
        source_url = excluded.source_url,
        image_url = COALESCE(NULLIF(excluded.image_url, ''), NULLIF(image_url, '')),
        images_json = COALESCE(NULLIF(excluded.images_json, ''), NULLIF(images_json, '')),
        tags_json = excluded.tags_json,
        amenities_json = excluded.amenities_json,
        offers_json = excluded.offers_json,
        raw_payload = excluded.raw_payload,
        data_updated_at = excluded.data_updated_at,
        primary_category = COALESCE(excluded.primary_category, primary_category),
        tagging_version = CASE WHEN excluded.primary_category IS NOT NULL THEN excluded.tagging_version ELSE tagging_version END,
        last_seen_at = excluded.last_seen_at,
        synced_at = excluded.synced_at`;

export function prepareDiscoveryUpsert(
  db: D1Database,
  item: DiscoveryItem,
  syncedAt: string,
): D1PreparedStatement {
  const row = discoveryRow(item, syncedAt);
  return db
    .prepare(DISCOVERY_UPSERT_SQL)
    .bind(
      row.id,
      row.type,
      row.source,
      row.sourceItemId,
      row.title,
      row.subtitle,
      row.categoryText,
      row.startDate,
      row.endDate,
      row.status,
      row.isFree,
      row.venueName,
      row.address,
      row.lat,
      row.lng,
      row.rating,
      row.reviewCount,
      row.lowestPriceText,
      row.lowestPricePlatform,
      row.sourceUrl,
      row.imageUrl,
      row.imagesJson,
      row.tagsJson,
      row.amenitiesJson,
      row.offersJson,
      row.rawPayload,
      row.dataUpdatedAt,
      row.primaryCategory,
      row.taggingVersion,
      syncedAt,
      syncedAt,
      syncedAt,
    );
}
```

- [ ] **Step 6: `discoveryRow()`에 필드 채우기**

`worker-backend/src/discoveryCache.ts:683-721`의 현재 블록:

```ts
function discoveryRow(
  item: DiscoveryItem,
  syncedAt: string,
): DiscoveryRowPayload {
  const isEvent = "eventType" in item;
  // Public API events are intentionally folded into the festival discovery domain for one map toggle and one cache type.
  return {
    id: isEvent ? `festival:${item.source}:${item.id}` : `festival:${item.id}`,
    type: "festival",
    source: item.source,
    sourceItemId: item.id,
    title: item.title,
    subtitle: isEvent ? item.shortDescription : item.subtitle,
    categoryText: isEvent ? item.eventType : item.tags.join(","),
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    isFree: isEvent ? (item.isFree ? 1 : 0) : null,
    venueName: item.venueName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    rating: null,
    reviewCount: null,
    lowestPriceText: isEvent ? (item.price ?? null) : null,
    lowestPricePlatform: null,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    imagesJson:
      item.imageUrls && item.imageUrls.length > 0
        ? JSON.stringify(item.imageUrls)
        : null,
    tagsJson: isEvent ? null : JSON.stringify(item.tags),
    amenitiesJson: null,
    offersJson: null,
    rawPayload: JSON.stringify(item),
    dataUpdatedAt: syncedAt,
  };
}
```

다음으로 교체 (`export` 추가 + `primaryCategory`/`taggingVersion` 채우기):

```ts
export function discoveryRow(
  item: DiscoveryItem,
  syncedAt: string,
): DiscoveryRowPayload {
  const isEvent = "eventType" in item;
  // Public API events are intentionally folded into the festival discovery domain for one map toggle and one cache type.
  return {
    id: isEvent ? `festival:${item.source}:${item.id}` : `festival:${item.id}`,
    type: "festival",
    source: item.source,
    sourceItemId: item.id,
    title: item.title,
    subtitle: isEvent ? item.shortDescription : item.subtitle,
    categoryText: isEvent ? item.eventType : item.tags.join(","),
    startDate: item.startDate,
    endDate: item.endDate,
    status: item.status,
    isFree: isEvent ? (item.isFree ? 1 : 0) : null,
    venueName: item.venueName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    rating: null,
    reviewCount: null,
    lowestPriceText: isEvent ? (item.price ?? null) : null,
    lowestPricePlatform: null,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    imagesJson:
      item.imageUrls && item.imageUrls.length > 0
        ? JSON.stringify(item.imageUrls)
        : null,
    tagsJson: isEvent ? null : JSON.stringify(item.tags),
    amenitiesJson: null,
    offersJson: null,
    rawPayload: JSON.stringify(item),
    dataUpdatedAt: syncedAt,
    primaryCategory: item.primaryCategory ?? null,
    taggingVersion: item.primaryCategory ? TAGGING_VERSION : 0,
  };
}
```

이 fix는 provider에 상관없이 동작한다: AKEI 이외의 모든 기존 provider는 `item.primaryCategory`를 in-memory로 설정하지 않으므로(LLM 태깅은 이 upsert 경로와 무관하게 별도 `UPDATE` 문으로 D1에 직접 쓴다) `COALESCE(null, primary_category)`가 항상 기존 값을 보존한다. AKEI는 매 사이클 `primaryCategory: "trade_expo"`를 설정하므로 매번 확정값이 반영된다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm -C worker-backend exec vitest run discoveryRow.test.ts`
Expected: PASS (3개 테스트 모두)

- [ ] **Step 8: 전체 회귀 테스트 + 타입체크**

Run: `pnpm -C worker-backend typecheck && pnpm -C worker-backend test`
Expected: PASS (기존 `discoveryCacheConcurrency.test.ts` 등 다른 discoveryCache 관련 테스트도 그대로 통과해야 한다)

- [ ] **Step 9: 커밋**

```bash
git add worker-backend/src/discoveryCache.ts worker-backend/tests/discoveryRow.test.ts && git commit -m "Persist primary_category/tagging_version through discovery upsert"
```

---

### Task 8: `discoverySchedule.ts`에 AKEI 청크 등록

**Files:**
- Modify: `worker-backend/src/discoverySchedule.ts:3-17`

**Interfaces:**
- Produces: `DISCOVERY_PROVIDER_CHUNKS`에 11번째 항목 `{ kind: "festivals", providers: ["akei-trade-expo"] }` 추가. `DISCOVERY_PROVIDER_CHUNK_COUNT`는 배열 길이에서 자동 파생되므로 별도 수정 불필요. `worker-backend/tests/discoverySchedule.test.ts`는 `DISCOVERY_PROVIDER_CHUNK_COUNT`를 동적으로 참조하는 범용 테스트라 수정 없이도 새 항목을 자동 검증한다.

- [ ] **Step 1: 배열에 항목 추가**

`worker-backend/src/discoverySchedule.ts:3-17`의 현재 블록:

```ts
export const DISCOVERY_PROVIDER_CHUNKS: Array<{
  kind: DiscoverySyncKind;
  providers: string[];
}> = [
  { kind: "festivals", providers: ["tourapi-festival"] },
  { kind: "festivals", providers: ["public-data-culture-festival"] },
  { kind: "festivals", providers: ["tourapi-area-festival"] },
  { kind: "festivals", providers: ["tourapi-keyword-festival"] },
  { kind: "events", providers: ["seoul-culture-event"] },
  { kind: "events", providers: ["culture-portal"] },
  { kind: "events", providers: ["kopis"] },
  { kind: "events", providers: ["kcisa_428"] },
  { kind: "events", providers: ["kcisa_196"] },
  { kind: "festivals", providers: ["city-scraped"] },
];
```

다음으로 교체:

```ts
export const DISCOVERY_PROVIDER_CHUNKS: Array<{
  kind: DiscoverySyncKind;
  providers: string[];
}> = [
  { kind: "festivals", providers: ["tourapi-festival"] },
  { kind: "festivals", providers: ["public-data-culture-festival"] },
  { kind: "festivals", providers: ["tourapi-area-festival"] },
  { kind: "festivals", providers: ["tourapi-keyword-festival"] },
  { kind: "events", providers: ["seoul-culture-event"] },
  { kind: "events", providers: ["culture-portal"] },
  { kind: "events", providers: ["kopis"] },
  { kind: "events", providers: ["kcisa_428"] },
  { kind: "events", providers: ["kcisa_196"] },
  { kind: "festivals", providers: ["city-scraped"] },
  { kind: "festivals", providers: ["akei-trade-expo"] },
];
```

- [ ] **Step 2: 기존 스케줄 테스트가 새 항목을 커버하는지 확인**

Run: `pnpm -C worker-backend exec vitest run discoverySchedule.test.ts`
Expected: PASS (테스트 파일 수정 없이 그대로 통과 — `DISCOVERY_PROVIDER_CHUNK_COUNT`를 동적으로 참조하기 때문)

- [ ] **Step 3: 커밋**

```bash
git add worker-backend/src/discoverySchedule.ts && git commit -m "Register akei-trade-expo in the discovery provider chunk rotation"
```

---

### Task 9: `index.ts` — provider 등록, cron 가드, admin 라우트

**Files:**
- Modify: `worker-backend/src/index.ts:1-45` (import), `:871-891` 부근(admin 라우트 추가), `:993-997`(cron 가드), `:1116-1118`(`loadDiscoveryRuntime`), `:1179-1191`(스케줄 wrapper 옆에 새 함수 추가), `:1286`(`importBackend`)

**Interfaces:**
- Consumes: `runAkeiTradeExpoDiscovery` from `./akeiTradeExpoDiscovery.js` (Task 4), `AkeiTradeExpoFestivalProvider` from `./akeiTradeExpoProvider.js` (Task 6).
- Produces: `POST /admin/sync-akei-trade-expos` 관리자 라우트, `scheduled()` 핸들러의 `hour===5` 가드, `festivalService` provider 배열에 AKEI 추가(두 조립 지점 모두).

- [ ] **Step 1: import 추가**

`worker-backend/src/index.ts:35` (`import { CityScrapedFestivalProvider } from "./cityScrapedFestivalProvider.js";` 바로 다음)에 추가:

```ts
import { runAkeiTradeExpoDiscovery } from "./akeiTradeExpoDiscovery.js";
import { AkeiTradeExpoFestivalProvider } from "./akeiTradeExpoProvider.js";
```

- [ ] **Step 2: admin 라우트 추가**

`worker-backend/src/index.ts:871-891`의 `/admin/sync-city-festivals` 라우트 블록 바로 다음(892번째 줄, 빈 줄 이후)에 추가:

```ts
app.post("/admin/sync-akei-trade-expos", async (c) => {
  const authResponse = authorizeAdminSync(c.req.raw, c.env);
  if (authResponse) return authResponse;
  if (!c.env.DB) {
    return c.json({ error: "d1_not_configured" }, 503);
  }
  try {
    const result = await runAkeiTradeExpoDiscovery(c.env.DB, new Date());
    return c.json(result);
  } catch (error) {
    return c.json(syncErrorResponse(error), 502);
  }
});
```

- [ ] **Step 3: cron 가드 추가**

`worker-backend/src/index.ts:993-997`의 현재 블록:

```ts
      // 전용 cron 슬롯을 새로 쓰지 않고, 이 시간당 트리거에 UTC 4시 가드를 얹어
      // 하루 1회 도시별 축제 스크래핑을 실행한다 (계정의 5개 cron trigger 한도 때문).
      if (scheduledAt.getUTCHours() === 4) {
        ctx.waitUntil(syncCityFestivalsScheduled(env, scheduledAt));
      }
      return;
```

다음으로 교체:

```ts
      // 전용 cron 슬롯을 새로 쓰지 않고, 이 시간당 트리거에 UTC 4시 가드를 얹어
      // 하루 1회 도시별 축제 스크래핑을 실행한다 (계정의 5개 cron trigger 한도 때문).
      if (scheduledAt.getUTCHours() === 4) {
        ctx.waitUntil(syncCityFestivalsScheduled(env, scheduledAt));
      }
      // 같은 이유로 AKEI 무역박람회 스크래핑은 UTC 5시 가드로 하루 1회 실행한다.
      if (scheduledAt.getUTCHours() === 5) {
        ctx.waitUntil(syncAkeiTradeExposScheduled(env, scheduledAt));
      }
      return;
```

- [ ] **Step 4: `loadDiscoveryRuntime()`에 provider 추가**

`worker-backend/src/index.ts:1116-1118`의 현재 블록:

```ts
      festivalService: createFestivalService(
        env.DB ? [new CityScrapedFestivalProvider(env.DB)] : [],
      ),
```

다음으로 교체:

```ts
      festivalService: createFestivalService(
        env.DB
          ? [new CityScrapedFestivalProvider(env.DB), new AkeiTradeExpoFestivalProvider(env.DB)]
          : [],
      ),
```

- [ ] **Step 5: 스케줄 wrapper 함수 추가**

`worker-backend/src/index.ts:1179-1191`의 `syncCityFestivalsScheduled` 함수 바로 다음(빈 줄 이후)에 추가:

```ts
async function syncAkeiTradeExposScheduled(env: Env, scheduledAt: Date): Promise<void> {
  try {
    const result = await runAkeiTradeExpoDiscovery(env.DB!, scheduledAt);
    if (result.failedMonths.length > 0 || result.unmappedVenues > 0) {
      console.warn(
        `akei trade expo discovery failedMonths=${result.failedMonths.join(",")} unmappedVenues=${result.unmappedVenues}`,
      );
    }
  } catch (error) {
    console.error("akei trade expo discovery sync failed", error);
    await notifyOpsFailure(env, "akei trade expo discovery sync", error);
  }
}
```

- [ ] **Step 6: `importBackend()`에 provider 추가**

`worker-backend/src/index.ts:1285-1287`의 현재 블록:

```ts
    festivalService: createFestivalService(
      env.DB ? [new CityScrapedFestivalProvider(env.DB)] : [],
    ),
```

다음으로 교체:

```ts
    festivalService: createFestivalService(
      env.DB
        ? [new CityScrapedFestivalProvider(env.DB), new AkeiTradeExpoFestivalProvider(env.DB)]
        : [],
    ),
```

- [ ] **Step 7: 타입체크**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS

- [ ] **Step 8: 전체 테스트**

Run: `pnpm -C worker-backend test`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add worker-backend/src/index.ts && git commit -m "Wire AkeiTradeExpoFestivalProvider into cron, admin route, and festival service"
```

---

### Task 10: iOS `DiscoverCategories.swift` — `tradeExpo` 케이스

**Files:**
- Modify: `ios-app/Core/Models/DiscoverCategories.swift`

**Interfaces:**
- Produces: `FestivalPrimaryCategory.tradeExpo`(rawValue `"trade_expo"`) — Task 11(`MapPinRenderer.swift`)의 `map(_:)` switch가 이 케이스를 exhaustively 처리해야 컴파일된다. `FilterSheetView.swift:165`의 `ForEach(FestivalPrimaryCategory.allCases, ...)`가 이 케이스를 자동으로 필터 칩에 반영하므로 별도 UI 파일 수정은 불필요하다.

- [ ] **Step 1: enum에 케이스 추가**

`ios-app/Core/Models/DiscoverCategories.swift`의 `FestivalPrimaryCategory` enum 정의에서 `case generalEvent = "general_event"` 다음, `case etc = "etc"` 이전에 추가:

```swift
case tradeExpo = "trade_expo"
```

- [ ] **Step 2: `displayName` switch에 케이스 추가**

`displayName` computed property의 switch문에서 `case .generalEvent: return "지역행사"` 다음 줄에 추가:

```swift
case .tradeExpo: return "산업·박람회"
```

- [ ] **Step 3: `systemImage` switch에 케이스 추가**

`systemImage` computed property의 switch문에서 `.generalEvent` 케이스 다음 줄에 추가:

```swift
case .tradeExpo: return "building.2.fill"
```

- [ ] **Step 4: `tint` switch에 케이스 추가**

`tint` computed property의 switch문에서 `.generalEvent` 케이스(`Color(red: 0.271, green: 0.427, blue: 0.663) // #4569A9`) 다음 줄에 추가:

```swift
case .tradeExpo: return Color(red: 0.361, green: 0.404, blue: 0.490) // #5C677D
```

- [ ] **Step 5: `emoji` switch에 케이스 추가**

`emoji` computed property의 switch문에서 `.generalEvent` 케이스 다음 줄에 추가:

```swift
case .tradeExpo: return "🏢"
```

- [ ] **Step 6: 4개 switch문 모두 exhaustive한지 확인**

Xcode에서 빌드하거나 `swift build`가 가능한 환경이면 컴파일해 4개 switch(`displayName`/`systemImage`/`tint`/`emoji`) 모두에 `.tradeExpo` 케이스가 빠짐없이 들어갔는지 확인한다. 하나라도 빠지면 Swift가 "switch must be exhaustive" 컴파일 에러를 낸다.

- [ ] **Step 7: 커밋**

```bash
git add ios-app/Core/Models/DiscoverCategories.swift && git commit -m "Add tradeExpo case to FestivalPrimaryCategory"
```

---

### Task 11: iOS `MapPinRenderer.swift` — trade_expo 핀 매핑

**Files:**
- Modify: `ios-app/Features/Map/MapPinRenderer.swift`
- Test: `ios-app/Tests/ParkingLotNavigatorTests.swift`

**Interfaces:**
- Consumes: `FestivalPrimaryCategory.tradeExpo` (Task 10).
- Produces: `MapPinCategory.map(_:)`가 `.tradeExpo`를 처리 — Task 10에서 enum에 새 case를 추가한 순간 이 함수의 switch가 non-exhaustive가 되어 컴파일이 깨지므로, 이 Task는 선택이 아니라 필수다.

- [ ] **Step 1: 실패하는 테스트 작성**

`ios-app/Tests/ParkingLotNavigatorTests.swift`의 `testMapPinCategoryGeneralEventFallsBackToKeyword()` 테스트 함수 바로 다음에 추가:

```swift
func testMapPinCategoryTradeExpoFallsBackToKeyword() {
    // tradeExpo는 전용 핀이 없고, 제목의 "박람회" 키워드로 exhibition 핀에 떨어진다
    XCTAssertEqual(MapPinCategory.resolve(primaryCategory: .tradeExpo, categoryTags: [], title: "산업 박람회", description: nil, rawTags: []), .exhibition)
    // 키워드 신호도 없으면 기본 핀
    XCTAssertEqual(MapPinCategory.resolve(primaryCategory: .tradeExpo, categoryTags: [], title: "웨딩 페어", description: nil, rawTags: []), .defaultFestival)
}
```

- [ ] **Step 2: 테스트 실행해 컴파일 실패 확인**

Xcode 또는 `xcodebuild test`로 `ParkingLotNavigatorTests` 타겟을 빌드한다.
Expected: 컴파일 에러 — `MapPinRenderer.swift`의 `map(_ category:)` switch가 `.tradeExpo`를 처리하지 않아 "switch must be exhaustive" 에러가 난다.

- [ ] **Step 3: `map(_:)` switch에 케이스 추가**

`ios-app/Features/Map/MapPinRenderer.swift`의 현재 코드:

```swift
    private static func map(_ category: FestivalPrimaryCategory) -> MapPinCategory? {
        switch category {
        case .musicPerformance: return .music
        case .foodDrink: return .food
        case .lightNight: return .night
        case .marketFlea: return .market
        case .artExhibition, .filmMedia: return .exhibition
        case .familyKids: return .family
        case .traditionCulture: return .tradition
        case .sportsOutdoor: return .sports
        case .natureFlower, .generalEvent, .etc: return nil  // 전용 카테고리 없음 → keyword/기본 핀으로
        }
    }
```

다음으로 교체:

```swift
    private static func map(_ category: FestivalPrimaryCategory) -> MapPinCategory? {
        switch category {
        case .musicPerformance: return .music
        case .foodDrink: return .food
        case .lightNight: return .night
        case .marketFlea: return .market
        case .artExhibition, .filmMedia: return .exhibition
        case .familyKids: return .family
        case .traditionCulture: return .tradition
        case .sportsOutdoor: return .sports
        case .natureFlower, .generalEvent, .etc, .tradeExpo: return nil  // 전용 카테고리 없음 → keyword/기본 핀으로
        }
    }
```

`tradeExpo`를 `nil`로 매핑해도 지도에서 사라지지 않는 이유: 기존 `keyword(in:)` 함수(`ios-app/Features/Map/MapPinRenderer.swift`)의 `"박람회"` 키워드 규칙(`if has(["전시", "미술", "아트", "박람회", "갤러리", "art"]) { return .exhibition }`)이 이미 존재해, 제목에 "박람회"가 들어간 AKEI 항목은 자동으로 exhibition 핀으로 떨어진다. 이 키워드 규칙은 수정하지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Xcode 또는 `xcodebuild test`로 `ParkingLotNavigatorTests` 타겟을 다시 빌드/실행한다.
Expected: PASS (`testMapPinCategoryTradeExpoFallsBackToKeyword` 포함 전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add ios-app/Features/Map/MapPinRenderer.swift ios-app/Tests/ParkingLotNavigatorTests.swift && git commit -m "Map tradeExpo to exhibition pin via title keyword fallback"
```

---

### Task 12: iOS 빌드 번호 증가

**Files:**
- Modify: `ios-app/project.yml:21`

**Interfaces:**
- 없음 (빌드 메타데이터만 변경).

- [ ] **Step 1: `CURRENT_PROJECT_VERSION` 증가**

`ios-app/project.yml:21`의:

```yaml
    CURRENT_PROJECT_VERSION: 197
```

다음으로 교체:

```yaml
    CURRENT_PROJECT_VERSION: 198
```

- [ ] **Step 2: XcodeGen 프로젝트 파일 재생성 확인**

Run: `cd ios-app && xcodegen generate` (XcodeGen이 설치돼 있다면)
Expected: `ParkingLotNavigator.xcodeproj`가 에러 없이 재생성됨.

- [ ] **Step 3: 커밋**

```bash
git add ios-app/project.yml && git commit -m "Bump build number to 198 for trade_expo category addition"
```

---

### Task 13: 통합 검증

**Files:** 없음 (검증 전용 task)

**Interfaces:** 없음

- [ ] **Step 1: worker-backend 전체 타입체크**

Run: `pnpm -C worker-backend typecheck`
Expected: PASS

- [ ] **Step 2: worker-backend 전체 테스트**

Run: `pnpm -C worker-backend test`
Expected: PASS (Task 1~9에서 추가한 모든 테스트 포함, 기존 테스트 전부 회귀 없음)

- [ ] **Step 3: backend preflight (shared-types 변경 영향 확인)**

Run: `pnpm --filter @parking/backend test && pnpm --filter @parking/backend preflight`
Expected: PASS

- [ ] **Step 4: iOS 빌드 확인 (가능한 경우)**

Xcode 또는 Codemagic으로 `ParkingLotNavigator` 타겟을 빌드해 Task 10/11의 Swift 변경이 컴파일되는지 확인한다.
Expected: 빌드 성공, `ParkingLotNavigatorTests` 전체 통과.

이 task는 커밋하지 않는다(검증만 수행).

---

## Self-Review 결과

**Spec coverage:** 스펙(`docs/superpowers/specs/2026-08-08-trade-expo-data-source-design.md`)의 데이터 흐름 1~6단계, 에러 처리 5개 항목, 테스트 요구사항 4개 카테고리, 아키텍처 섹션(AKEI 단일 소스, `primary_category` 즉시 확정, 하드코딩 벤뉴 매핑, cron 재사용, 카테고리/UI 패턴)이 모두 Task 1~11에 매핑된다. "범위 밖" 3개 항목(상세 페이지 크롤링, MICE365, 벤뉴 매핑 완전성)은 어떤 Task에도 포함하지 않았다.

**Placeholder scan:** 전체 plan에 TBD/TODO/"적절히 처리" 류 표현 없음. 모든 코드 블록이 실행 가능한 완전한 코드다.

**Type consistency:** `AkeiRawCandidate`(Task 4) → `resolveExhibitionVenue`가 반환하는 `ExhibitionVenue`(Task 3)를 `buildUpsertStatement`가 그대로 소비. `AkeiTradeExpoRow`(Task 5)의 컬럼명이 Task 1의 마이그레이션 컬럼명과 정확히 일치. `queryAkeiTradeExposFromCache`의 시그니처 `(db, lat, lng, radiusMeters, upcomingWithinDays)`가 `cityFestivalCache.ts`의 동명 함수 시그니처와 동일해 `AkeiTradeExpoFestivalProvider`(Task 6)가 `DiscoverQuery`의 필드명과 어긋나지 않는다. `discoveryRow`/`prepareDiscoveryUpsert`(Task 7)는 이 plan의 다른 어떤 Task도 직접 호출하지 않는 독립 수정이라 다른 Task와의 타입 충돌 여지가 없다. `FestivalPrimaryCategory.tradeExpo`(Task 10)가 `MapPinRenderer.map(_:)`(Task 11)의 switch에 정확히 한 번 추가됐다.
