import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../../../../backend/src/features/discover/events/eventProviderUtils.js";
import { DETAIL_FETCH_CONCURRENCY, mapWithConcurrency } from "../types.js";
import type { CitySiteConfig, RawCityFestivalCandidate, DetailFetchBudget } from "../types.js";

const DETAIL_FETCH_TIMEOUT_MS = 8000;

// 인천관광공사 통합 포털(itour.incheon.go.kr) "축제" 목록
// (ssst/ssst/list.do?pageNm=fstv)은 li.item_fstv 반복 구조이고 div.date에
// "2026.08.14 ~2026.11.08" 형식의 실제 날짜가 있다. 다만 상세 링크가
// <a href="javascript:;" name="btn_detail" cotId="...">라 href 속성이 없고
// cotId 속성만 있어(cheerio는 속성명을 소문자로 정규화하므로 attr("cotid")로
// 읽는다) declarative parser의 href 기반 링크 추출로는 상세 URL을 만들 수
// 없다. cotId로 상세 URL(detail.do?cotId=...)을 직접 조립하기 위해 커스텀
// 파서로 처리한다.
// 목록 페이지에는 위치 정보가 전혀 없다. 상세 페이지의 .location ul.list
// 첫 항목(주소)이 .text 안에 도로명 주소를 담고 있어(2026-08-09 여러
// cotId로 교차 확인) 상세 페이지를 항목당 한 번씩 추가로 fetch해 채운다.
// 국가유산청 순회전시처럼 12개 지역을 한 항목으로 묶은 예외적인 행사는
// 주소 칸에 여러 지역명이 나열돼 있어 Kakao geocoding이 실패하면 그대로
// fallback 좌표로 남는다(정상 동작).
export async function parseIncheonItourFestival(
  html: string,
  config: CitySiteConfig,
  budget?: DetailFetchBudget
): Promise<RawCityFestivalCandidate[]> {
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

  await mapWithConcurrency(results, DETAIL_FETCH_CONCURRENCY, (candidate) =>
    fillLocationFromDetailPage(candidate, budget, config.siteId)
  );

  return results;
}

async function fillLocationFromDetailPage(
  candidate: RawCityFestivalCandidate,
  budget: DetailFetchBudget | undefined,
  siteId: string
): Promise<void> {
  if (!candidate.detailUrl) return;
  if (budget && !budget.tryConsume(siteId)) return;
  try {
    const response = await fetchWithTimeout(
      new URL(candidate.detailUrl),
      { headers: { "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0" } },
      DETAIL_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return;
    const $detail = cheerio.load(await response.text());
    const address = $detail(".location .text").first().text().replace(/\s+/g, " ").trim();
    if (address) candidate.addressRaw = address;
  } catch {
    // best-effort: 상세 페이지 fetch 실패는 무시하고 fallback 좌표로 남긴다
  }
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}
