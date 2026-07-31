import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 속초문화관광재단(sokchocf.or.kr) "공연·행사·공모" 페이지는 GET으로는 분야
// 필터가 걸리지 않고(폼이 method="post"), POST로 mode=banner&searchCondition=
// TYPE&searchKeyword=E 를 보내야 분야가 "축제"인 항목만 담긴 캐러셀이 반환된다
// (2026-07-31 실측, fetchMethod: "POST" 로 등록). cDate 값은 캐러셀 결과에
// 영향을 주지 않는 것을 확인(임의 날짜로 재요청해도 동일 목록 반환).
// 상세 링크도 href="#" + onclick="fncEventDetail(317, '2026-07-31');" 방식이라
// calendarSeq를 추출해 상세 GET URL(schedule/detail)을 직접 만든다.
// 참고: https(443)는 접속이 거부되고 http(80)만 응답한다(2026-07-31 실측).
export function parseSokchoCulture(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".calender_banner ul.clearfix > li").each((_index, element) => {
    const item = $(element);
    const title = item.find(".text_box p").first().text().trim() || null;
    if (!title) return;

    const dateRaw = item.find(".text_box em").first().text().trim() || null;
    if (!dateRaw) return;

    const imageSrc = item.find(".img_box img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);

    const onclick = item.find(".mouseover.event").first().attr("onclick") ?? "";
    const idMatch = onclick.match(/fncEventDetail\((\d+),\s*'([^']+)'\)/);
    const detailUrl = idMatch
      ? `http://sokchocf.or.kr/sokchocf/event/schedule/detail?calendarSeq=${idMatch[1]}&cDate=${idMatch[2]}`
      : config.listUrl;

    results.push({
      title,
      startDateRaw: dateRaw,
      endDateRaw: dateRaw,
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
