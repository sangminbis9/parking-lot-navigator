import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 의정부시(ui4u.go.kr) "알림마당 행사목록"은 GET 쿼리스트링으로는 검색 필터가
// 적용되지 않고(폼이 method="post"), POST로 searchType=CATE&searchTxt=축제를
// 보내야 분야가 "축제"인 항목만 걸러진다(2026-07-31 실측, fetchMethod: "POST"
// 로 등록). 상세 링크도 href 없는 onclick="fn_go_view(idx); return false;"
// 방식이라 idx를 추출해 view.do URL을 직접 만든다.
export function parseUijeongbuEvent(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $("table.bod_list tbody tr").each((_index, element) => {
    const cells = $(element).find("td");
    if (cells.length < 7) return;

    const titleLink = cells.eq(2).find("a").first();
    const title = titleLink.text().trim() || null;
    if (!title) return;

    const startDateRaw = cells.eq(3).text().trim() || null;
    const endDateRaw = cells.eq(4).text().trim() || null;
    if (!startDateRaw) return;

    const venueRaw = cells.eq(5).text().trim() || null;

    const onclick = titleLink.attr("onclick") ?? "";
    const idMatch = onclick.match(/fn_go_view\((\d+)\)/);
    const detailUrl = idMatch
      ? `https://www.ui4u.go.kr/portal/eventNoti/view.do?mId=0301170100&idx=${idMatch[1]}`
      : config.listUrl;

    results.push({
      title,
      startDateRaw,
      endDateRaw,
      venueRaw,
      addressRaw: null,
      detailUrl,
      imageUrl: null
    });
  });

  return results;
}
