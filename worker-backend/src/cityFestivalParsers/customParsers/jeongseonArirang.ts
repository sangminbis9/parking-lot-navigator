import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 정선아리랑문화재단(arirangfestival.kr)은 제목/날짜/장소가 모두
// <a class="bo_tit">제목텍스트<p>날짜</p><p>장소</p></a> 한 태그 안에 있고,
// 제목만 앞쪽 텍스트 노드로 존재해 CSS 셀렉터로는 제목만 따로 골라낼 수 없다.
// contents().first()로 첫 텍스트 노드(제목)를 집어내고, 날짜/장소는 각각
// 첫 번째·두 번째 <p>에서 읽는다.
export function parseJeongseonArirang(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $("li.gall_li").each((_index, element) => {
    const item = $(element);
    const titleAnchor = item.find("a.bo_tit").first();
    const title = titleAnchor.contents().first().text().trim() || null;
    const dateText = titleAnchor.find("p").eq(0).text().trim() || null;
    const venueRaw = titleAnchor.find("p").eq(1).text().trim() || null;
    const linkHref = titleAnchor.attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref, config.listUrl);
    const imageSrc = item.find(".gall_img img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw,
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
