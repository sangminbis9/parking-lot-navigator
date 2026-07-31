import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 달서문화재단(dscf.or.kr) "축제" 콘텐츠 페이지(main/contents.do?a_num=28659473)는
// div.photo_list > div.top_box 반복 구조로 5개 항목(2026-07-31 실측)이 있고,
// 기간(dl.date dd)에 "2026. 05. 15.(Fri) ~ 05. 17.(Sun)" 형식의 실제 날짜가
// 있다. 같은 dd 안에 과거 값이 남은 HTML 주석(<!-- 2025. 1월 중 -->)이 있지만
// cheerio .text()는 주석 노드를 건너뛰므로 파싱에 영향 없음. 종료일은 시작일과
// 같은 연/월을 공유하는 경우가 있어(예: "05. 15.(Fri) ~ 05. 17.(Sun)") 시작일의
// 연도를 그대로 재사용한다. 상세 링크는 div.btn_w 안에 "전년도 자료"/"내용 보기"
// 두 개 버튼이 있어 "내용 보기" 쪽을 선택한다.
const DATE_RE =
  /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\([^)]*\)(?:\s*~\s*(\d{1,2})\.\s*(\d{1,2})\.\([^)]*\))?/;

function pad(value: string): string {
  return value.padStart(2, "0");
}

export function parseDalseoDscf(html: string, config: CitySiteConfig): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".photo_list > .top_box").each((_index, element) => {
    const item = $(element);

    const titleEl = item.find("h5").first().clone();
    titleEl.find("span.tag").remove();
    const title = titleEl.text().trim() || null;
    if (!title) return;

    const dateRaw = item.find("dl.date dd").first().text().replace(/\s+/g, " ").trim();
    const match = dateRaw.match(DATE_RE);
    if (!match) return;
    const [, year, startMonth, startDay, endMonth, endDay] = match;
    const startDateRaw = `${year}-${pad(startMonth)}-${pad(startDay)}`;
    const endDateRaw = endMonth && endDay ? `${year}-${pad(endMonth)}-${pad(endDay)}` : startDateRaw;

    const venueRaw = item.find("dl.place dd").first().text().trim() || null;

    const detailHref =
      item
        .find(".btn_w a")
        .filter((_, a) => $(a).text().trim() === "내용 보기")
        .attr("href") ?? null;
    const detailUrl = resolveUrl(detailHref, config.listUrl) ?? config.listUrl;

    const imageSrc = item.find(".img_box img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);

    results.push({
      title,
      startDateRaw,
      endDateRaw,
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
