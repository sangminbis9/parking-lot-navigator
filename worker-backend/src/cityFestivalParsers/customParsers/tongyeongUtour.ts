import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 통영U투어(utour.go.kr)는 셀렉터만으로는 표현 안 되는 날짜 형식을 쓴다.
// "2026. 3. 16일(월) 09:00 ~ 2026. 3. 22일(일)  18:00"처럼 구분자(.) 뒤에
// 공백이 있어 cityFestivalNormalize.ts의 날짜 정규식이 매칭하지 못한다.
// 여기서 공백을 제거해 "2026.3.16일(월)09:00~2026.3.22일(일)18:00" 형태로
// 만든 뒤 공용 정규식이 그대로 인식하게 한다.
export function parseTongyeongUtour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".schedule1list li").each((_index, element) => {
    const item = $(element);
    const title = item.find("strong.h1").first().text().trim() || null;
    const dateRaw = item.find("dl.date dd").first().text().trim();
    const dateText = dateRaw ? dateRaw.replace(/\s+/g, "") : null;
    const linkHref = item.find("a.f1").first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref, config.listUrl);
    const imageSrc = item.find("a.f1 img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);
    const venueRaw = item.find("dl.place dd").first().text().trim() || null;

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
