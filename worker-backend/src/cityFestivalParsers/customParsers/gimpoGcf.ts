import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 김포시청(www.gimpo.go.kr)은 robots.txt가 User-agent: * / Disallow: /로
// 일반 크롤러를 전면 차단한다(2026-07-30 확인). 대신 김포문화재단
// (www.gcf.or.kr, robots.txt Allow: /)의 축제 목록을 쓴다. list.do?mthd=FEST&
// state_se=<상태>(ing=진행/exp=예정/end=종료)로 서버사이드 필터링되고, 상태별로
// listUrl을 나눠 등록한다(진행+예정만, 종료는 제외). 일시는
// <td class="left">2026-08-15<span> ~ </span>2026-08-16</td>처럼 시작일과
// 종료일이 같은 셀에 들어 있어, 텍스트 전체를 넘기면 cityFestivalNormalize.ts의
// 날짜 정규식이 두 날짜를 순서대로 잡아낸다(2026-07-31 curl 확인).
const BASE_URL = "https://www.gcf.or.kr/main/exh/";

export function parseGimpoGcf(
  html: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".exh_list > li.evt_item").each((_index, element) => {
    const item = $(element);

    const title = item.find(".evt_list_title").first().text().trim() || null;

    const dateText = item
      .find(".evt_view tr")
      .filter((_i, tr) => $(tr).find("th").text().trim() === "일시")
      .first()
      .find("td")
      .text()
      .trim();
    const venueText = item
      .find(".evt_view tr")
      .filter((_i, tr) => $(tr).find("th").text().trim() === "장소")
      .first()
      .find("td")
      .text()
      .trim();

    const linkHref = item.find(".btm_btns a.bd--line").first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref);

    const imageSrc = item.find(".evt_img img").first().attr("src") ?? null;

    if (!title || !dateText) return;

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
