import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 인천관광공사 통합 포털(itour.incheon.go.kr) "축제" 목록
// (ssst/ssst/list.do?pageNm=fstv)은 li.item_fstv 반복 구조이고 div.date에
// "2026.08.14 ~2026.11.08" 형식의 실제 날짜가 있다. 다만 상세 링크가
// <a href="javascript:;" name="btn_detail" cotId="...">라 href 속성이 없고
// cotId 속성만 있어(cheerio는 속성명을 소문자로 정규화하므로 attr("cotid")로
// 읽는다) declarative parser의 href 기반 링크 추출로는 상세 URL을 만들 수
// 없다. cotId로 상세 URL(detail.do?cotId=...)을 직접 조립하기 위해 커스텀
// 파서로 처리한다.
export function parseIncheonItourFestival(html: string, config: CitySiteConfig): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $("li.item_fstv").each((_index, element) => {
    const item = $(element);
    const linkEl = item.find(".subject a[name='btn_detail']").first();
    const title = linkEl.text().trim() || null;
    if (!title) return;

    const cotId = linkEl.attr("cotid") ?? null;
    const detailUrl = cotId
      ? `https://itour.incheon.go.kr/ssst/ssst/detail.do?cotId=${cotId}`
      : config.listUrl;

    const dateText = item.find("div.date").first().text().trim() || null;

    const imageSrc = item.find(".photo img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
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
