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

    const startMonth = parseMonth(startMonthRaw);
    const endMonth = parseMonth(endMonthRaw);
    if (startMonth === null || endMonth === null) {
      return;
    }

    const endYear = endMonth < startMonth ? year + 1 : year;
    // 일자 칸이 비어있거나 "미정"이어도 월이 확정되면 행 전체를 버리지 않는다.
    // 시작일 미상은 해당 월 1일로, 종료일 미상은 종료월 말일로 보수적으로 채운다.
    const startDay = parseDay(startDayRaw) ?? 1;
    const endDay = parseDay(endDayRaw) ?? lastDayOfMonth(endYear, endMonth);

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

// 월 칸은 "5월중"처럼 뒤에 안내 문구가 붙는 경우가 있어, 맨 앞 1~2자리
// 숫자만 뽑아 월(1~12)로 인정한다. 앞자리 숫자조차 없으면(빈 칸, "미정" 등)
// 월을 확정할 수 없으므로 null을 돌려주고 호출부에서 행 전체를 제외한다.
function parseMonth(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,2})/);
  if (!match) return null;
  const value = Number(match[1]);
  if (value < 1 || value > 12) return null;
  return value;
}

// 일자 칸은 순수 1~2자리 숫자일 때만 인정한다. "미정"이나 빈 칸은 null을
// 돌려주고, 호출부가 월 기준으로 합리적인 기본값(1일/말일)을 채운다.
function parseDay(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  return Number(trimmed);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
