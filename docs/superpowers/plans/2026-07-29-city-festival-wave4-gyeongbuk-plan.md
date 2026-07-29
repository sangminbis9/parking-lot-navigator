# City Festival Wave 4 (경북) Implementation Plan

> **⚠️ 폐기됨 (2026-07-29):** 이 계획이 전제한 `tour.gb.go.kr` 공유 AJAX endpoint는 Cloudflare Workers egress IP 대역을 WAF가 전면 차단해(`wrangler dev --remote`로 직접 확인, "Web firewall security policy" 위반 HTTP 404) 데이터 소스로 쓸 수 없었다. 파서(`gyeongbukTour.ts`)와 POST fetch 확장은 코드에 남겨뒀지만 어떤 site config도 등록하지 않았다. 대신 21개 시/군을 개별 사이트로 재조사해 5곳(경주/포항/상주/김천/영덕)만 wave 5로 등록했다 — 자세한 내용은 `worker-backend/src/cityFestivalSites.ts`의 wave 5 주석과 `worker-backend/src/cityFestivalParsers/customParsers/{gyeongjuTour,pohangTour,sangjuTour}.ts` 참고. 아래 계획 본문은 폐기된 접근 방식의 기록으로만 남겨둔다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경상북도 21개 시/군(경산시는 파일럿으로 이미 등록됨, 군위군은 목록에 없어 제외)을 city-festival scraper에 등록한다.

**Architecture:** wave 2/3와 마찬가지로 `CitySiteConfig` + `CustomParserFn` + D1 `city_festivals` 프레임워크를 재사용하되, 경북 관광포털(`tour.gb.go.kr`)은 HTML 표/카드가 아니라 **JSON을 반환하는 AJAX POST endpoint**(`/travel/selectListAdd.do`)를 쓴다는 점이 다르다. 이 endpoint는 `cd_area` 파라미터에 콤마로 여러 시/군 코드를 넘기면 한 번의 요청으로 다중 시/군 결과를 함께 반환하고, 응답 JSON에 `latitude`/`longtitude`가 이미 채워져 있어 Kakao geocoding이 필요 없다. 21개 시/군이 동일한 POST body(모든 코드 포함)를 공유해 fetch 1회로 처리되므로(청북 wave의 listUrl 공유 캐시 재사용), Cloudflare Workers subrequest 한도 문제(이번 세션에서 청북 wave 때 겪은 문제)를 원천적으로 피한다.

이를 위해 기존 프레임워크에 두 가지를 확장한다:
1. `discoverSite`가 GET 외에 POST(+body)도 지원하도록.
2. `RawCityFestivalCandidate`/`normalizeCandidate`가 이미 알고 있는 lat/lng를 받으면 Kakao resolver를 거치지 않고 그대로 쓰도록.

**Tech Stack:** Cloudflare Worker, TypeScript (JSON 파싱, cheerio 불필요)

## Global Constraints

- endpoint: `POST https://tour.gb.go.kr/travel/selectListAdd.do`, `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`, body: `start=0&end=500&cd_catetop=03&cd_catemid=02&title=&search=&cd_area=<콤마목록>&favority_month=`. `cd_catetop=03&cd_catemid=02`는 "축제" 카테고리 고정값(2026-07-29 실측, `festival.js` 소스에서 확인). `end=500`은 현재 21개 시/군 합계 91건보다 훨씬 크게 잡아 페이지네이션 없이 한 번에 전량을 받기 위함이다.
- robots.txt는 `https://tour.gb.go.kr/robots.txt` → `Allow:/`, `Disallow:/admin` 뿐이라 `/travel/selectListAdd.do`는 제한 없음. `robotsCheckedAt: "2026-07-29"`.
- 응답 JSON 최상위: `{ rcode: "1", dataCount: number, data: [...] }`. `data[]` 각 항목의 주요 필드: `idx`, `title`, `dt_start`("YYYY-MM-DD"), `dt_end`, `addr_inf`, `latitude`, `longtitude`, `area_txt`(시/군 이름, "시/군/구" 접미사 없이 "포항" 형태), `cd_area`(코드), `file_physical`(썸네일 파일명, 없으면 null).
- 시/군 코드 매핑(2026-07-29 `festival.do` HTML의 `cd_area` 체크박스에서 확인, `24`=경북 전체는 실제 시/군이 아니므로 제외, `01`=경산은 이미 파일럿 `gyeongsan-gsctf`로 등록되어 제외, `05`는 코드가 존재하지 않음):
  `02`=경주, `03`=고령, `04`=구미, `06`=김천, `07`=문경, `08`=봉화, `09`=상주, `10`=성주, `11`=안동, `12`=영덕, `13`=영양, `14`=영주, `15`=영천, `16`=예천, `17`=울릉, `18`=울진, `19`=의성, `20`=청도, `21`=청송, `22`=칠곡, `23`=포항.
- 파서는 `area_txt`가 아니라 `cd_area` 코드로 시/군을 가른다(문자열 접미사 불일치 위험을 피하기 위해 숫자 코드로 매칭). 이를 위해 `CitySiteConfig`에 커스텀 파서 전용 필드(`customParserArea`) 하나를 추가한다.
- `detailUrl`은 `https://tour.gb.go.kr/travel/festivalView.do?idx=<idx>`, `imageUrl`은 `file_physical`이 있으면 `https://tour.gb.go.kr/file/thumbnail2.do?file_physical=<file_physical>`, 없으면 `null`.
- `addr_inf`를 `addressRaw`로만 채우고(별도 장소명 필드가 없음) `venueRaw`는 `null`로 둔다.
- lat/lng는 JSON의 `latitude`/`longtitude`를 그대로 candidate에 실어 보내고, `normalizeCandidate`가 이 값이 있으면 Kakao resolver를 호출하지 않고 그대로 채택하도록 한다. 이 변경은 이번 wave 전용이 아니라 향후 좌표 제공 사이트에도 재사용 가능한 일반 확장이다.
- 새 커스텀 파서에는 전용 유닛 테스트 파일을 만들지 않는다 — wave 2/3 관례를 따른다. 대신 실제 curl로 받은 JSON으로 파서 출력을 수동 검증한다.

---

### Task 1: POST fetch 지원 + lat/lng passthrough 확장

**Files:**
- Modify: `worker-backend/src/cityFestivalParsers/types.ts`
- Modify: `worker-backend/src/cityFestivalDiscovery.ts`
- Modify: `worker-backend/src/cityFestivalNormalize.ts`

**Interfaces:**
- Produces: `CitySiteConfig.fetchMethod?: "GET" | "POST"`, `CitySiteConfig.fetchBody?: string`, `CitySiteConfig.customParserArea?: string`, `RawCityFestivalCandidate.lat?: number | null`, `RawCityFestivalCandidate.lng?: number | null`.

- [ ] **Step 1: 타입 확장**

`worker-backend/src/cityFestivalParsers/types.ts`에 필드 추가:

```typescript
export interface RawCityFestivalCandidate {
  title: string | null;
  startDateRaw: string | null;
  endDateRaw: string | null;
  venueRaw: string | null;
  addressRaw: string | null;
  detailUrl: string | null;
  imageUrl: string | null;
  lat?: number | null;
  lng?: number | null;
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
    venueSelector?: string;
    addressSelector?: string;
  };
  customParser?: string;
  // customParser가 하나의 listUrl을 공유하는 여러 site config를 구분할 때 쓰는
  // 범용 파라미터(예: 경북 wave의 cd_area 코드). customParser별로 의미가 다르다.
  customParserArea?: string;
  fetchMethod?: "GET" | "POST";
  fetchBody?: string;
}
```

- [ ] **Step 2: `discoverSite`가 POST를 지원하도록 수정**

`worker-backend/src/cityFestivalDiscovery.ts`의 `discoverSite` 함수에서 fetch 호출 부분을 다음으로 교체한다(캐시 키는 그대로 `site.listUrl` — 같은 wave 안에서 body도 동일하므로 문제 없음):

```typescript
      try {
        const response = await fetchWithTimeout(
          new URL(site.listUrl),
          {
            method: site.fetchMethod ?? "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0",
              ...(site.fetchMethod === "POST"
                ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
                : {})
            },
            ...(site.fetchBody ? { body: site.fetchBody } : {})
          },
          CITY_FESTIVAL_FETCH_TIMEOUT_MS
        );
```

- [ ] **Step 3: warmup 대상에서 좌표를 이미 아는 candidate 제외**

같은 파일의 `runCityFestivalDiscovery`에서 `resolver.warmup(...)` 호출 앞 `.filter(...)`를 수정한다:

```typescript
      await resolver.warmup(
        candidates
          .filter((c) => (c.addressRaw || c.venueRaw) && !(typeof c.lat === "number" && typeof c.lng === "number"))
          .map((c) => ({
            title: c.title ?? "",
            venue: c.venueRaw,
            address: c.addressRaw,
            region: site.cityName
          }))
      );
```

- [ ] **Step 4: `normalizeCandidate`가 candidate의 lat/lng를 우선하도록 수정**

`worker-backend/src/cityFestivalNormalize.ts`의 `resolveCoordinates`와 `normalizeCandidate`를 수정한다:

```typescript
async function resolveCoordinates(
  input: { title: string; venueRaw: string | null; addressRaw: string | null; lat?: number | null; lng?: number | null },
  config: CitySiteConfig,
  resolver: EventCoordinateResolver | null
): Promise<{ lat: number; lng: number }> {
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    return { lat: input.lat, lng: input.lng };
  }

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
```

`normalizeCandidate` 안의 `resolveCoordinates(...)` 호출부에 `lat`/`lng`를 추가로 넘긴다:

```typescript
  const { lat, lng } = await resolveCoordinates(
    { title, venueRaw: candidate.venueRaw, addressRaw: candidate.addressRaw, lat: candidate.lat, lng: candidate.lng },
    config,
    resolver
  );
```

- [ ] **Step 5: typecheck**

```bash
pnpm -C worker-backend typecheck
```

기대: 에러 없이 통과.

---

### Task 2: 경북 커스텀 파서 등록 + 21개 시/군 사이트 등록

**Files:**
- Create: `worker-backend/src/cityFestivalParsers/customParsers/gyeongbukTour.ts`
- Modify: `worker-backend/src/cityFestivalParsers/customParsers/index.ts`
- Modify: `worker-backend/src/cityFestivalSites.ts`

**Interfaces:**
- Consumes: Task 1에서 확장한 `CitySiteConfig.customParserArea`, `RawCityFestivalCandidate.lat`/`lng`.
- Produces: `CUSTOM_PARSERS["gyeongbuk-tour"]`, `CITY_FESTIVAL_SITES`에 21개 항목(`gyeongbuk-tour-<city>` siteId) 추가.

- [ ] **Step 1: 커스텀 파서 작성**

`worker-backend/src/cityFestivalParsers/customParsers/gyeongbukTour.ts`:

```typescript
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 경북관광(tour.gb.go.kr)의 축제 목록은 HTML이 아니라 JSON을 반환하는 AJAX
// POST endpoint(/travel/selectListAdd.do)로 제공된다. cd_area 파라미터에
// 콤마로 여러 시/군 코드를 넘기면 한 번의 요청으로 시/군 전체 결과가
// 함께 오므로, 21개 시/군이 동일한 listUrl+body(config.fetchBody에 모든
// 코드가 포함됨)를 공유하고, 파서 안에서 item.cd_area와
// config.customParserArea(해당 사이트가 맡은 코드)를 비교해 나눈다.
// 응답에 latitude/longtitude가 이미 있어 Kakao geocoding이 필요 없다.
const DETAIL_BASE = "https://tour.gb.go.kr/travel/festivalView.do?idx=";
const THUMB_BASE = "https://tour.gb.go.kr/file/thumbnail2.do?file_physical=";

interface GyeongbukFestivalItem {
  idx: number;
  title: string | null;
  dt_start: string | null;
  dt_end: string | null;
  addr_inf: string | null;
  latitude: string | null;
  longtitude: string | null;
  cd_area: string | null;
  file_physical: string | null;
}

interface GyeongbukFestivalResponse {
  rcode: string;
  dataCount: number;
  data: GyeongbukFestivalItem[];
}

export function parseGyeongbukTour(
  json: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  let parsed: GyeongbukFestivalResponse;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (parsed.rcode !== "1" || !Array.isArray(parsed.data)) return [];

  const results: RawCityFestivalCandidate[] = [];
  for (const item of parsed.data) {
    if (item.cd_area !== config.customParserArea) continue;

    const lat = item.latitude ? Number(item.latitude) : NaN;
    const lng = item.longtitude ? Number(item.longtitude) : NaN;

    results.push({
      title: item.title || null,
      startDateRaw: item.dt_start || null,
      endDateRaw: item.dt_end || null,
      venueRaw: null,
      addressRaw: item.addr_inf || null,
      detailUrl: item.idx ? `${DETAIL_BASE}${item.idx}` : null,
      imageUrl: item.file_physical ? `${THUMB_BASE}${item.file_physical}` : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    });
  }

  return results;
}
```

- [ ] **Step 2: 커스텀 파서 레지스트리에 등록**

`worker-backend/src/cityFestivalParsers/customParsers/index.ts`:

```typescript
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";
import { parseTongyeongUtour } from "./tongyeongUtour.js";
import { parseJeongseonArirang } from "./jeongseonArirang.js";
import { parseChungnamTour } from "./chungnamTour.js";
import { parseChungbukTour } from "./chungbukTour.js";
import { parseGyeongbukTour } from "./gyeongbukTour.js";

export type CustomParserFn = (html: string, config: CitySiteConfig) => RawCityFestivalCandidate[];

export const CUSTOM_PARSERS: Record<string, CustomParserFn> = {
  "tongyeong-utour": parseTongyeongUtour,
  "jeongseon-arirang": parseJeongseonArirang,
  "chungnam-tour": parseChungnamTour,
  "chungbuk-tour": parseChungbukTour,
  "gyeongbuk-tour": parseGyeongbukTour
};
```

- [ ] **Step 3: 21개 시/군을 CITY_FESTIVAL_SITES에 등록**

`worker-backend/src/cityFestivalSites.ts`의 배열 마지막(충북 블록 뒤) 닫는 `]` 앞에 콤마를 추가하고 아래 블록을 붙인다:

```typescript
  ,
  // wave 4: 경상북도 21개 시/군(경산시는 파일럿 gyeongsan-gsctf로 이미 등록,
  // 군위군은 cd_area 코드 목록에 없어 제외). tour.gb.go.kr는 HTML이 아니라
  // JSON을 반환하는 AJAX POST endpoint(/travel/selectListAdd.do)로 축제
  // 목록을 제공하고, cd_area에 콤마로 여러 코드를 넘기면 21개 시/군 전체
  // 결과가 한 번의 요청으로 온다. 응답에 좌표(latitude/longtitude)가 이미
  // 있어 Kakao geocoding을 타지 않는다. robots.txt는 Allow:/ 로 제한 없음.
  // 2026-07-29 실측.
  ...[
    { siteId: "gyeongbuk-tour-gyeongju", cityName: "경주시", area: "02", lat: 35.8562, lng: 129.2247 },
    { siteId: "gyeongbuk-tour-goryeong", cityName: "고령군", area: "03", lat: 35.7263, lng: 128.2629 },
    { siteId: "gyeongbuk-tour-gumi", cityName: "구미시", area: "04", lat: 36.1196, lng: 128.3441 },
    { siteId: "gyeongbuk-tour-gimcheon", cityName: "김천시", area: "06", lat: 36.1398, lng: 128.1136 },
    { siteId: "gyeongbuk-tour-mungyeong", cityName: "문경시", area: "07", lat: 36.5966, lng: 128.1867 },
    { siteId: "gyeongbuk-tour-bonghwa", cityName: "봉화군", area: "08", lat: 36.8931, lng: 128.7328 },
    { siteId: "gyeongbuk-tour-sangju", cityName: "상주시", area: "09", lat: 36.4109, lng: 128.159 },
    { siteId: "gyeongbuk-tour-seongju", cityName: "성주군", area: "10", lat: 35.9192, lng: 128.2828 },
    { siteId: "gyeongbuk-tour-andong", cityName: "안동시", area: "11", lat: 36.5684, lng: 128.7294 },
    { siteId: "gyeongbuk-tour-yeongdeok", cityName: "영덕군", area: "12", lat: 36.4152, lng: 129.3657 },
    { siteId: "gyeongbuk-tour-yeongyang", cityName: "영양군", area: "13", lat: 36.6667, lng: 129.1122 },
    { siteId: "gyeongbuk-tour-yeongju", cityName: "영주시", area: "14", lat: 36.8056, lng: 128.6239 },
    { siteId: "gyeongbuk-tour-yeongcheon", cityName: "영천시", area: "15", lat: 35.9733, lng: 128.9386 },
    { siteId: "gyeongbuk-tour-yecheon", cityName: "예천군", area: "16", lat: 36.6579, lng: 128.4522 },
    { siteId: "gyeongbuk-tour-ulleung", cityName: "울릉군", area: "17", lat: 37.4845, lng: 130.9057 },
    { siteId: "gyeongbuk-tour-uljin", cityName: "울진군", area: "18", lat: 36.993, lng: 129.4006 },
    { siteId: "gyeongbuk-tour-uiseong", cityName: "의성군", area: "19", lat: 36.3527, lng: 128.697 },
    { siteId: "gyeongbuk-tour-cheongdo", cityName: "청도군", area: "20", lat: 35.6474, lng: 128.734 },
    { siteId: "gyeongbuk-tour-cheongsong", cityName: "청송군", area: "21", lat: 36.436, lng: 129.0572 },
    { siteId: "gyeongbuk-tour-chilgok", cityName: "칠곡군", area: "22", lat: 35.9955, lng: 128.4016 },
    { siteId: "gyeongbuk-tour-pohang", cityName: "포항시", area: "23", lat: 36.019, lng: 129.3435 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: "https://tour.gb.go.kr/travel/selectListAdd.do",
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-29",
    customParser: "gyeongbuk-tour",
    customParserArea: entry.area,
    fetchMethod: "POST",
    fetchBody:
      "start=0&end=500&cd_catetop=03&cd_catemid=02&title=&search=&favority_month=&cd_area=" +
      "02,03,04,06,07,08,09,10,11,12,13,14,15,16,17,18,19,20,21,22,23"
  }))
```

- [ ] **Step 4: 실제 JSON으로 파서 수동 검증**

이미 받아둔 실측 JSON으로 파서가 올바르게 동작하는지 직접 확인한다(커밋 대상 아님, 검증용 1회성 스크립트). `/tmp/gb_ajax_all.json`은 이 계획을 세우며 `cd_area=02,...,23`으로 미리 curl한 응답이다:

```bash
cd worker-backend
node -e '
const fs = require("fs");
const raw = fs.readFileSync("/tmp/gb_ajax_all.json", "utf-8");
const parsed = JSON.parse(raw);
const byArea = {};
for (const item of parsed.data) {
  byArea[item.cd_area] = (byArea[item.cd_area] || 0) + 1;
}
console.log("dataCount", parsed.dataCount, "총 아이템", parsed.data.length);
console.log(byArea);
console.log("포항(23) 샘플", parsed.data.find((d) => d.cd_area === "23"));
'
```

기대값: 이전 조사에서 확인한 `dataCount: 91`, `cd_area` 코드별 건수(안동 12, 문경 10, 경주 10, 포항 8, 예천 6, 영덕 6, 영주 6, 봉화 5, 김천 5, 영양 4, 칠곡 3, 성주 3, 울릉 2, 청도 2, 의성 2, 상주 2, 고령 1, 구미 1, 청송 1, 영천 1, 울진 1)와 일치해야 한다.

- [ ] **Step 5: typecheck**

```bash
pnpm -C worker-backend typecheck
```

- [ ] **Step 6: 기존 테스트 스위트 실행**

```bash
pnpm --filter @parking/backend test
```

기대: 기존 테스트 모두 통과(이 task는 새 테스트 파일을 추가하지 않음 — wave 2/3 관례를 따름).

- [ ] **Step 7: Worker 배포 및 production 검증**

```bash
pnpm -C worker-backend deploy
```

배포 후 wave 4가 속한 chunk index를 계산해 `chunkIndex` 쿼리 파라미터로 그 청크만 강제 실행한다(현재 사이트 수 = 5 파일럿 + 15 충남 + 11 충북 + 21 경북 = 52개, `CITY_FESTIVAL_CHUNK_SIZE=15`이므로 chunkCount=4, 경북 21개는 chunk index 3(마지막 15개 부족분)과 index... 실제로는 배열에서 경북 블록이 시작하는 인덱스를 기준으로 `sitesForChunk` 계산 후 필요한 chunk index들을 모두 확인한다):

```bash
curl -s -X POST -H "Authorization: Bearer $SYNC_ADMIN_TOKEN" \
  "https://parking-lot-navigator-api.parkingnav.workers.dev/admin/sync-city-festivals?chunkIndex=<N>"
```

각 chunk 호출이 `failedSites: []`인지 확인하고, D1에서 `gyeongbuk-tour-%` site_id로 실제 row가 들어갔는지 확인한다:

```bash
pnpm -C worker-backend exec wrangler d1 execute parking-lot-navigator --remote --command "SELECT site_id, COUNT(*) FROM city_festivals WHERE site_id LIKE 'gyeongbuk-tour-%' GROUP BY site_id"
```

- [ ] **Step 8: 커밋**

```bash
git add worker-backend/src/cityFestivalParsers/types.ts worker-backend/src/cityFestivalDiscovery.ts worker-backend/src/cityFestivalNormalize.ts worker-backend/src/cityFestivalParsers/customParsers/gyeongbukTour.ts worker-backend/src/cityFestivalParsers/customParsers/index.ts worker-backend/src/cityFestivalSites.ts docs/superpowers/plans/2026-07-29-city-festival-wave4-gyeongbuk-plan.md
git commit -m "Add Gyeongbuk (경북) 21-site wave to city festival scraper via JSON AJAX endpoint"
```
