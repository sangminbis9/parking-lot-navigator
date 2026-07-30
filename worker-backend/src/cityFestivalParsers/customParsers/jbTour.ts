import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 전북특별자치도 관광포털(tour.jb.go.kr)의 축제 목록은 /travel/info/list.do에
// sigun_cd_arr(시/군 코드) 쿼리 파라미터를 붙이면 실제로 서버사이드에서
// 걸러진다(2026-07-30 curl 재검증: jsessionid를 정규화하고 코드별로 비교하니
// "총 N건" 카운트와 항목 자체가 코드마다 다름 — 무주 11건/장수 7건/전주 26건 등).
// 이전에는 /index.do?...&sigun_cd_arr=...로 테스트해 파라미터가 무효라고
// 결론 내렸으나, 그 URL은 항상 /travel/info/list.do로 302 리다이렉트되면서
// sigun_cd_arr이 리다이렉트 대상 URL에서 빠져 매번 동일한(필터 안 된) 첫 페이지로
// 착지하는 게 원인이었다. 그래서 시/군마다 sigun_cd_arr가 다른 listUrl을
// 개별로 쓰고(chungnam-tour와 같은 패턴), 뱃지 텍스트로 재필터링할 필요가 없다.
// 날짜는 "기간: 2026.09.04~09.12"처럼 종료일에 연도·월이 생략돼 있어(시작일만
// 전체 YYYY.MM.DD), pohangTour.ts와 같은 방식으로 앞 조각의 연도를 이어받고
// 종료월이 시작월보다 작으면(연말→연초) 종료 연도에 1을 더한다.
const BASE_URL = "https://tour.jb.go.kr";

export function parseJbTour(
  html: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".serchList .photoWrap").each((_index, element) => {
    const item = $(element);

    const title = item.find("h3 strong").first().text().trim() || null;

    const periodText = item
      .find(".stay_infobox li")
      .filter((_i, li) => $(li).text().includes("기간"))
      .first()
      .text()
      .trim();
    const { startDate, endDate } = parsePeriod(periodText);
    if (!startDate) return;

    const linkHref = item.find("a[href]").first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref);

    const imageSrc = item.find("img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(imageSrc);

    results.push({
      title,
      startDateRaw: startDate,
      endDateRaw: endDate ?? startDate,
      venueRaw: null,
      addressRaw: null,
      detailUrl,
      imageUrl
    });
  });

  return results;
}

// "기간: 2026.09.04~09.12" 같은 텍스트를 "YYYY-MM-DD"/"YYYY-MM-DD"로 재구성한다.
// 둘째 조각에 연도가 없으면 첫 조각의 연도를 이어받고, 종료월이 시작월보다
// 작으면 연도 걸침으로 보고 1을 더한다. 파싱 실패 시 null을 돌려줘 호출부가
// 해당 항목을 제외하게 한다(추측으로 날짜를 채우지 않음).
function parsePeriod(raw: string): { startDate: string | null; endDate: string | null } {
  const text = raw.replace(/^기간\s*:?\s*/, "").trim();
  const parts = text.split("~").map((part) => part.trim());
  if (parts.length === 0 || !parts[0]) return { startDate: null, endDate: null };

  const startMatch = parts[0].match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!startMatch) return { startDate: null, endDate: null };
  const startYear = Number(startMatch[1]);
  const startMonth = Number(startMatch[2]);
  const startDay = Number(startMatch[3]);
  const startDate = `${startYear}-${pad(startMonth)}-${pad(startDay)}`;

  if (parts.length < 2 || !parts[1]) {
    return { startDate, endDate: startDate };
  }

  const endFull = parts[1].match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (endFull) {
    return {
      startDate,
      endDate: `${endFull[1]}-${pad(Number(endFull[2]))}-${pad(Number(endFull[3]))}`
    };
  }

  const endShort = parts[1].match(/(\d{1,2})[.\-/](\d{1,2})/);
  if (endShort) {
    const endMonth = Number(endShort[1]);
    const endDay = Number(endShort[2]);
    const endYear = endMonth < startMonth ? startYear + 1 : startYear;
    return { startDate, endDate: `${endYear}-${pad(endMonth)}-${pad(endDay)}` };
  }

  return { startDate, endDate: startDate };
}

function resolveUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
