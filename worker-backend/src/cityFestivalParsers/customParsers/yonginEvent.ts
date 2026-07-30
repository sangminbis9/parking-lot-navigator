import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 용인시 문화관광포털(www.yongin.go.kr)의 행사 목록은 날짜/장소가 라벨과 값이
// 분리된 두 개의 <span> 형제로 되어 있다(예: <li><span>행사기간 : </span>
// <span>2026.03.20 ~ 2026.12.06</span></li>). declarative selector로는 라벨
// 텍스트까지 함께 잡혀 정규화가 불안정해, 라벨 텍스트로 행을 찾고 두 번째
// span만 값으로 뽑는다(2026-07-31 curl 확인).
const BASE_URL = "https://www.yongin.go.kr/user/web/eventyt/";

export function parseYonginEvent(
  html: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".gallery_bbs_list4 > ul > li").each((_index, element) => {
    const item = $(element);

    const title = item.find(".gallery_bbs_txt .tit").first().text().trim() || null;
    const linkHref = item.find(".gallery_bbs_txt a[href]").first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref);

    const infoItems = item.find(".gallery_bbs_txt > ul > li");
    const dateText = infoItems
      .filter((_i, el) => $(el).text().includes("행사기간"))
      .first()
      .find("span")
      .eq(1)
      .text()
      .trim();
    const venueText = infoItems
      .filter((_i, el) => $(el).text().includes("장소"))
      .first()
      .find("span")
      .eq(1)
      .text()
      .trim();

    const imageSrc = item.find(".gallery_bbs_img img").first().attr("src") ?? null;

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
