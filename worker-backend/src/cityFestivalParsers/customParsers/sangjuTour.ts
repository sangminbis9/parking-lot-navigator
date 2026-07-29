import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 상주시(sangju.go.kr) 축제 게시판은 상세 링크가 href 없는
// onclick="festivalList.view('100421')" JS 네비게이션이라 href 기반
// linkSelector로는 상세 URL을 만들 수 없다(사이트 자체 상세 라우트를
// 확인하지 못해 목록 페이지로 폴백). 2026-07-29 실측에서 취소된 축제가
// 제목에 "「제25회 한여름밤의 축제」 취소 안내"처럼 "취소" 문구를 달고
// 그대로 목록에 남아있는 것을 확인해, 진짜 축제처럼 노출되지 않도록
// 제목에 "취소"가 들어간 항목은 제외한다.
export function parseSangjuTour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $("li.list_item").each((_index, element) => {
    const item = $(element);
    const title = item.find("span.tit").first().text().trim() || null;
    if (!title || title.includes("취소")) return;

    const dateText = item.find("div.desc span.item").eq(0).find("span").first().text().trim() || null;
    const venueRaw = item.find("div.desc span.item").eq(1).find("span").first().text().trim() || null;
    const imageSrc = item.find("img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw,
      addressRaw: null,
      detailUrl: config.listUrl,
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
