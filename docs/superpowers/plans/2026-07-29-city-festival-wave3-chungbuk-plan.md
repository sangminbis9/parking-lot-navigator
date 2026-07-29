# City Festival Wave 3 (충북) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 충청북도 11개 시/군을 city-festival scraper에 등록해 wave 2(충남 15개)와 같은 방식으로 지도/캘린더에 노출한다.

**Architecture:** `docs/superpowers/specs/2026-07-29-city-festival-226-expansion-design.md`에서 확립된 프레임워크(`CitySiteConfig` + `CustomParserFn` + D1 `city_festivals`)를 그대로 재사용한다. 충북은 11개 시/군이 `tour.chungbuk.go.kr`의 단일 게시판 페이지 하나(공유 URL)에 표 형태로 함께 노출되므로, 충남(`chungnam-tour`)과 마찬가지로 커스텀 파서 하나를 만들어 11개 사이트가 공유하고, 파서 내부에서 `config.cityName`으로 표의 행을 필터링한다.

**Tech Stack:** Cloudflare Worker, TypeScript, cheerio (기존 커스텀 파서와 동일)

## Global Constraints

- `listUrl`은 `https://tour.chungbuk.go.kr/www/selectBbsNttList.do?bbsNo=10&key=80` — `searchCtgry` 쿼리 파라미터는 실측 결과(파라미터 없음/`2025`/`2026` 세 가지 모두 동일한 67개 `<tr>`, 동일한 `<h3>2026년 연간 지역축제 개최 계획</h3>`)로 확인했을 때 응답에 아무 영향을 주지 않으므로 붙이지 않는다. 연도를 URL에 하드코딩하지 않는다.
- robots.txt는 `https://tour.chungbuk.go.kr/robots.txt` → HTTP 404(파일 없음, 크롤링 제한 선언 없음)로 확인됨. `robotsCheckedAt: "2026-07-29"`.
- 표 각 행은 날짜에 연도가 없고 월/일만 있다. 연도는 파싱 시점의 `new Date().getFullYear()`를 기준 연도로 사용하고, 종료월이 시작월보다 작으면(연말→연초로 넘어가는 축제) 종료 연도에 +1 한다.
- 날짜 칸이 `미정`이거나 비어 있는 등 1~2자리 숫자가 아닌 행은 candidate를 만들지 않고 제외한다(추측 금지 — 이미 사용자 승인된 설계 결정).
- 표에는 상세 링크·썸네일·주소가 없다. `detailUrl`/`imageUrl`/`addressRaw`는 모두 `null`로 두고 `venueRaw`만 채운다. (`hasDetailUrl=false`이므로 최대 점수는 0.8이지만 auto-publish 임계값 0.7은 여전히 넘는다.)
- 11개 시/군이 동일한 `listUrl`을 각자 fetch한다(중복 호출을 줄이는 캐싱 레이어는 추가하지 않는다 — 저빈도 배치 작업이라 위험보다 구현 복잡도가 더 크다는 이미 승인된 판단).
- 새 커스텀 파서에는 전용 유닛 테스트 파일을 만들지 않는다 — 기존 `chungnam-tour`/`tongyeong-utour`/`jeongseon-arirang` 파서 모두 전용 테스트가 없고, 실제 HTML을 curl로 받아 수동 검증하는 것이 이 코드베이스의 기존 관례다. 대신 구현 중 실제 fetch한 HTML로 파서 출력을 직접 검증한다.

---

### Task 1: 충북 커스텀 파서 등록 + 11개 시/군 사이트 등록

**Files:**
- Create: `worker-backend/src/cityFestivalParsers/customParsers/chungbukTour.ts`
- Modify: `worker-backend/src/cityFestivalParsers/customParsers/index.ts`
- Modify: `worker-backend/src/cityFestivalSites.ts`

**Interfaces:**
- Consumes: `CitySiteConfig`, `RawCityFestivalCandidate`, `CustomParserFn` (모두 `worker-backend/src/cityFestivalParsers/types.ts` 및 `customParsers/index.ts`에 이미 정의됨). `parseCityDateRange`(`cityFestivalNormalize.ts`)가 `startDateRaw`/`endDateRaw`에서 `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY/MM/DD`, `YYYY년 MM월 DD일` 패턴만 인식하므로, 파서는 월/일 두 칸을 연도와 합쳐 `YYYY-MM-DD` 형태의 완전한 문자열로 만들어 넘겨야 한다.
- Produces: `CUSTOM_PARSERS["chungbuk-tour"]`, `CITY_FESTIVAL_SITES` 배열에 11개 항목 추가(`chungbuk-tour-<city>` siteId).

- [ ] **Step 1: 커스텀 파서 작성**

`worker-backend/src/cityFestivalParsers/customParsers/chungbukTour.ts`:

```typescript
import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 충청북도 관광포털(tour.chungbuk.go.kr)의 연간축제일정 게시판. 11개 시/군이
// 같은 페이지(bbsNo=10&key=80) 안의 표 한 곳에 함께 노출되며, 표의 첫 번째
// <td>(기초자치단체명)로 시/군을 가른다. "본청"(충북도 자체 행사)은 11개
// 시/군 이름 어디에도 매칭되지 않아 자연스럽게 제외된다.
// 표 컬럼: 기초자치단체명 | 축제명 | 장소명 | 시작월 | 시작일 | 종료월 | 종료일.
// 연도 컬럼이 없어 파싱 시점의 현재 연도를 기준으로 삼고, 종료월이 시작월보다
// 작으면(연말→연초로 이어지는 축제) 종료 연도에 1을 더한다.
export function parseChungbukTour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];
  const year = new Date().getFullYear();

  $("table.table tbody tr").each((_index, element) => {
    const cells = $(element)
      .find("td")
      .map((_i, td) => $(td).text().trim())
      .get();
    if (cells.length !== 7) return;

    const [cityName, title, venue, startMonthRaw, startDayRaw, endMonthRaw, endDayRaw] = cells;
    if (cityName !== config.cityName) return;

    const startMonth = parseDayOrMonth(startMonthRaw);
    const startDay = parseDayOrMonth(startDayRaw);
    const endMonth = parseDayOrMonth(endMonthRaw);
    const endDay = parseDayOrMonth(endDayRaw);
    if (startMonth === null || startDay === null || endMonth === null || endDay === null) {
      return;
    }

    const endYear = endMonth < startMonth ? year + 1 : year;

    results.push({
      title: title || null,
      startDateRaw: `${year}-${pad(startMonth)}-${pad(startDay)}`,
      endDateRaw: `${endYear}-${pad(endMonth)}-${pad(endDay)}`,
      venueRaw: venue || null,
      addressRaw: null,
      detailUrl: null,
      imageUrl: null
    });
  });

  return results;
}

// "미정" 등 숫자가 아닌 값이나 빈 칸은 날짜를 확정할 수 없으므로 null을
// 돌려주고, 호출부에서 해당 행 전체를 제외한다(추측으로 날짜를 채우지 않음).
function parseDayOrMonth(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  return Number(trimmed);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
```

- [ ] **Step 2: 커스텀 파서 레지스트리에 등록**

`worker-backend/src/cityFestivalParsers/customParsers/index.ts`을 다음과 같이 수정한다(기존 3개 항목 유지, `chungbuk-tour` 추가):

```typescript
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";
import { parseTongyeongUtour } from "./tongyeongUtour.js";
import { parseJeongseonArirang } from "./jeongseonArirang.js";
import { parseChungnamTour } from "./chungnamTour.js";
import { parseChungbukTour } from "./chungbukTour.js";

export type CustomParserFn = (html: string, config: CitySiteConfig) => RawCityFestivalCandidate[];

export const CUSTOM_PARSERS: Record<string, CustomParserFn> = {
  "tongyeong-utour": parseTongyeongUtour,
  "jeongseon-arirang": parseJeongseonArirang,
  "chungnam-tour": parseChungnamTour,
  "chungbuk-tour": parseChungbukTour
};
```

- [ ] **Step 3: 11개 시/군을 CITY_FESTIVAL_SITES에 등록**

`worker-backend/src/cityFestivalSites.ts`의 배열 마지막(충남 블록 뒤) 닫는 `]` 앞에 아래 블록을 추가한다. `fallbackLat`/`fallbackLng`는 각 시/군 청사 근방 좌표다:

```typescript
  ,
  // wave 3: 충청북도 11개 시/군. tour.chungbuk.go.kr의 "연간축제일정"
  // 게시판 표 하나에 11개 시/군이 모두 함께 노출되고(searchCtgry 파라미터는
  // 응답에 영향을 주지 않아 붙이지 않음 — 2026-07-29 실측), 표의
  // 기초자치단체명 컬럼으로 시/군을 가른다. 마크업이 동일하므로
  // chungbuk-tour custom parser 하나를 공유한다.
  // robots.txt는 404(제한 선언 없음)로 확인했다. 2026-07-29 실측.
  ...[
    { siteId: "chungbuk-tour-cheongju", cityName: "청주시", lat: 36.6424, lng: 127.489 },
    { siteId: "chungbuk-tour-chungju", cityName: "충주시", lat: 36.991, lng: 127.9259 },
    { siteId: "chungbuk-tour-jecheon", cityName: "제천시", lat: 37.1326, lng: 128.191 },
    { siteId: "chungbuk-tour-boeun", cityName: "보은군", lat: 36.4894, lng: 127.7295 },
    { siteId: "chungbuk-tour-okcheon", cityName: "옥천군", lat: 36.3062, lng: 127.5713 },
    { siteId: "chungbuk-tour-yeongdong", cityName: "영동군", lat: 36.175, lng: 127.7764 },
    { siteId: "chungbuk-tour-jeungpyeong", cityName: "증평군", lat: 36.7852, lng: 127.5811 },
    { siteId: "chungbuk-tour-jincheon", cityName: "진천군", lat: 36.8551, lng: 127.4355 },
    { siteId: "chungbuk-tour-goesan", cityName: "괴산군", lat: 36.8154, lng: 127.7872 },
    { siteId: "chungbuk-tour-eumseong", cityName: "음성군", lat: 36.9401, lng: 127.6902 },
    { siteId: "chungbuk-tour-danyang", cityName: "단양군", lat: 36.9845, lng: 128.3656 }
  ].map<CitySiteConfig>((entry) => ({
    siteId: entry.siteId,
    cityName: entry.cityName,
    listUrl: "https://tour.chungbuk.go.kr/www/selectBbsNttList.do?bbsNo=10&key=80",
    fallbackLat: entry.lat,
    fallbackLng: entry.lng,
    robotsCheckedAt: "2026-07-29",
    customParser: "chungbuk-tour"
  }))
```

주의: 배열 리터럴 안에서 두 스프레드 블록(충남/충북)을 이어 붙이는 문법이므로, 충남 블록 끝의 `]` 뒤에 콤마를 넣고 위 블록을 붙인 뒤 최종 `]`로 배열을 닫는다. 기존 충남 블록의 마지막 줄(`...].map<CitySiteConfig>(...)`)뒤에 콤마가 없다면 추가한다.

- [ ] **Step 4: 실제 HTML로 파서 수동 검증**

이미 받아둔 실측 HTML로 파서가 올바르게 동작하는지 직접 확인한다(커밋 대상 아님, 검증용 1회성 스크립트):

```bash
cd worker-backend
node -e '
const cheerio = require("cheerio");
const fs = require("fs");
const html = fs.readFileSync("/tmp/claude-1000/-home-sangmin-dev-git-parking-lot-navigator/fd18f01f-2726-4546-9d6c-1d921e75c635/scratchpad/chungbuk_noyear.html", "utf-8");
const $ = cheerio.load(html);
const rows = $("table.table tbody tr");
let cheongju = 0, danyang = 0, skipped = 0;
rows.each((_, el) => {
  const cells = $(el).find("td").map((_i, td) => $(td).text().trim()).get();
  if (cells.length !== 7) return;
  const [city, , , sm, sd, em, ed] = cells;
  const numOk = (v) => /^\d{1,2}$/.test(v);
  if (city === "청주시") { cheongju++; if (![sm,sd,em,ed].every(numOk)) skipped++; }
  if (city === "단양군") danyang++;
});
console.log({ cheongju, danyang, skipped });
'
```

기대값: `cheongju` 행 수(19, 표 전수조사에서 확인한 값)와 `danyang`(2)이 나오고, `skipped`는 날짜가 불완전한 청주시 행("본청" 아님, "미정" 등)이 있으면 그 수만큼 나온다. TypeScript 컴파일러가 아닌 이 임시 검증에서 파서 로직(월/일 파싱, 시/군 필터링)이 실제 데이터에 대해 예외 없이 동작하는지 확인하는 것이 목적이다.

- [ ] **Step 5: typecheck**

```bash
pnpm -C worker-backend typecheck
```

기대: 에러 없이 통과.

- [ ] **Step 6: 기존 테스트 스위트 실행**

```bash
pnpm --filter @parking/backend test
```

기대: 기존 테스트 모두 통과(이 task는 새 테스트 파일을 추가하지 않음 — Global Constraints 참고).

- [ ] **Step 7: 커밋**

```bash
git add worker-backend/src/cityFestivalParsers/customParsers/chungbukTour.ts worker-backend/src/cityFestivalParsers/customParsers/index.ts worker-backend/src/cityFestivalSites.ts docs/superpowers/plans/2026-07-29-city-festival-wave3-chungbuk-plan.md
git commit -m "Add Chungbuk (충북) 11-site wave to city festival scraper"
```
