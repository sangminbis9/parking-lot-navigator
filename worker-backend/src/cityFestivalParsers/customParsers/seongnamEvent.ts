import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 성남시 문화관광(seongnam.go.kr) "이달의 행사" 게시판은 상세 링크가 href 없는
// onclick="f_view('3754')" 방식이라 href 기반 linkSelector로 상세 URL을 만들 수
// 없다. 목록의 날짜 텍스트도 "2026.06.30(화) ~ 12.31(목)"처럼 종료일에 연도가
// 생략되는 범위가 있어 declarative selector/기본 정규화 로직으로는 종료일을
// 정확히 못 잡는다(2026-07-31 실측). 그래서 목록 카드에서 시작일 연도를 종료일에
// 보정해 "YYYY-MM-DD" 형태로 직접 만들어 startDateRaw/endDateRaw에 넘긴다.
const DATE_RANGE_RE =
  /(\d{4})\.(\d{1,2})\.(\d{1,2})\([^)]*\)(?:\s*~\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})\([^)]*\))?/;

function pad(value: string): string {
  return value.padStart(2, "0");
}

function parseSeongnamDate(raw: string): { startDateRaw: string | null; endDateRaw: string | null } {
  const match = raw.match(DATE_RANGE_RE);
  if (!match) return { startDateRaw: null, endDateRaw: null };
  const [, y1, m1, d1, y2, m2, d2] = match;
  const startDateRaw = `${y1}-${pad(m1)}-${pad(d1)}`;
  if (!m2 || !d2) {
    return { startDateRaw, endDateRaw: startDateRaw };
  }
  const endDateRaw = `${y2 ?? y1}-${pad(m2)}-${pad(d2)}`;
  return { startDateRaw, endDateRaw };
}

export function parseSeongnamEvent(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".board-gallery-body li").each((_index, element) => {
    const item = $(element);
    const title = item.find("dt.tit").first().text().trim() || null;
    if (!title) return;

    const dateText = item.find("dd.info span.date").first().text().trim();
    const { startDateRaw, endDateRaw } = parseSeongnamDate(dateText);
    if (!startDateRaw) return;

    const onclick = item.find("a").first().attr("onclick") ?? "";
    const idMatch = onclick.match(/f_view\('(\d+)'\)/);
    const detailUrl = idMatch
      ? resolveUrl(`/tour/tu-pm020101/${idMatch[1]}`, config.listUrl)
      : config.listUrl;

    const imageSrc = item.find("img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);

    results.push({
      title,
      startDateRaw,
      endDateRaw,
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
