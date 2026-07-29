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
