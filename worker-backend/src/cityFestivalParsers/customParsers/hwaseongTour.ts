import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 화성시문화관광(tour.hscity.go.kr) "축제·행사 일정" 페이지는 연 1회 개편되는
// 정적 표(연간 주요 축제 목록)라 상세 링크나 좌표가 없고, 날짜도
// "5. 22.(금) ~ 25.(월)"처럼 연도 없이 월.일만 적힌다(2026-07-31 실측).
// 페이지 제목("2026년 화성시 주요 축제·행사 일정")에서 연도를 뽑아 각 행의
// 날짜에 보정해 붙인다. "하반기(10월 말 예정)"처럼 정확한 일자가 없는 행은
// 정규식이 매치되지 않아 자연스럽게 제외된다.
const YEAR_RE = /(\d{4})년/;
const ROW_DATE_RE = /(\d{1,2})\.\s*(\d{1,2})\.\([^)]*\)(?:\s*~\s*(\d{1,2})\.\([^)]*\))?/;

function pad(value: string): string {
  return value.padStart(2, "0");
}

export function parseHwaseongTour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  const yearMatch = $("h1").first().text().match(YEAR_RE);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

  $("table.listBoard tbody tr").each((_index, element) => {
    const cells = $(element).find("td");
    const dateText = cells.eq(1).text().trim();
    const title = cells.eq(2).text().trim() || null;
    const venueRaw = cells.eq(4).text().trim() || null;
    if (!title) return;

    const dateMatch = dateText.match(ROW_DATE_RE);
    if (!dateMatch) return;
    const [, month, day1, day2] = dateMatch;
    const startDateRaw = `${year}-${pad(month)}-${pad(day1)}`;
    const endDateRaw = day2 ? `${year}-${pad(month)}-${pad(day2)}` : startDateRaw;

    results.push({
      title,
      startDateRaw,
      endDateRaw,
      venueRaw,
      addressRaw: null,
      detailUrl: config.listUrl,
      imageUrl: null
    });
  });

  return results;
}
