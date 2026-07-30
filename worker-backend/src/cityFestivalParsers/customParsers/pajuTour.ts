import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 파주시 문화관광포털(tour.paju.go.kr)의 축제 목록은 항목 상세 링크가 실제
// href가 아니라 onclick="jsCulturalView(<N>); return false;"에만 있다
// (2026-07-31 curl 확인). 상세 URL은 BD_selectCulturalView.do?cultMstSn=<N>
// 로 재구성한다. q_rowPerPage=200으로 요청하면 페이지네이션 없이 전체
// (104건, 2026-07-31 기준)를 한 번에 받을 수 있다. q_cultClassCd=1001은
// "축제" 카테고리만 가져온다(1002는 "행사" — 이번 등록에서는 제외해 축제
// 도메인에 집중한다).
const BASE_URL = "https://tour.paju.go.kr/user/link/cultural/";

export function parsePajuTour(
  html: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $("ul.event_list > li").each((_index, element) => {
    const item = $(element);

    const titleSpan = item.find(".titl").first();
    const title = titleSpan.clone().find("em").remove().end().text().trim() || null;

    const onclick = item.find("a.thumbnail_area").first().attr("onclick") ?? "";
    const idMatch = onclick.match(/jsCulturalView\((\d+)\)/);
    const detailUrl = idMatch
      ? `${BASE_URL}BD_selectCulturalView.do?cultMstSn=${idMatch[1]}`
      : null;

    const infoItems = item.find(".list-info em");
    const dateText = infoItems
      .filter((_i, el) => $(el).text().includes("행사"))
      .first()
      .text()
      .replace(/^\s*행사\s*:?\s*/, "")
      .trim();
    const venueText = infoItems
      .filter((_i, el) => $(el).text().includes("장소"))
      .first()
      .text()
      .replace(/^\s*장소\s*:?\s*/, "")
      .trim();

    const imageSrc = item.find(".thumb img").first().attr("src") ?? null;

    if (!title || !detailUrl || !dateText) return;

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw: venueText || null,
      addressRaw: null,
      detailUrl,
      imageUrl: resolveUrl(imageSrc)
    });
  });

  return results;
}

function resolveUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}
