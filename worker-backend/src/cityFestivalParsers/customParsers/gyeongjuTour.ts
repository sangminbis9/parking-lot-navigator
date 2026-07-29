import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 경주시 문화관광(gyeongju.go.kr)의 문화행사 목록은 축제/행사/전시/공연이
// 한 목록에 함께 노출되고, 각 항목의 <p class="title"> 안 <span> 뱃지
// 클래스(jun=전시, hang=행사, gong=공연, fest=축제)로만 구분된다.
// declarativeParser는 "이 자식이 있으면만 포함" 필터링을 못 하므로(모든
// itemSelector 매치를 무조건 포함), 축제(span.fest)만 남기려면 custom
// parser가 필요하다. 2026-07-29 실측 기준 표본 dl 12개 중 fest 뱃지는
// 드물게 등장하지만(당시 표본 0건), 다른 달에는 실제로 존재함을
// gyeongbuk wave 조사에서 확인했다.
export function parseGyeongjuTour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $("div.month > dl").each((_index, element) => {
    const item = $(element);
    const titleP = item.find("dd p.title").first();
    if (titleP.find("span.fest").length === 0) return;

    const title = titleP
      .clone()
      .find("span")
      .remove()
      .end()
      .text()
      .trim();
    if (!title) return;

    const dateText = item.find("dd > ul > li:first-child").first().text().trim() || null;
    const venueRaw = item.find("dd > ul > li:nth-child(2)").first().text().trim() || null;
    const linkHref = item.find("dt a").first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref, config.listUrl);
    const imageSrc = item.find("dt img").first().attr("src") ?? null;
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
