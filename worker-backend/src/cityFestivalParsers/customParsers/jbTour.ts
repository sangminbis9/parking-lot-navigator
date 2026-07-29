import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 전북특별자치도 관광포털(tour.jb.go.kr)의 축제 목록(index.do?menuCd=...&category_top_id=c)은
// 14개 시/군 전체가 한 페이지에 섞여 나온다. sigun_cd_arr/pageindex GET
// 파라미터를 바꿔도 응답이 동일해(2026-07-30 curl 확인, 전주/군산/익산/정읍
// 그룹과 무주/장수/임실/고창/부안 그룹 모두 재현) 서버사이드 필터/페이지네이션이
// 없다 — 첫 페이지 약 36~40건만 항상 접근 가능하고, 시/군 구분은
// .list_best_badge의 뱃지 텍스트로만 가능하다. 그래서 13개 시/군(순창은
// 파일럿에서 이미 등록)이 같은 listUrl을 공유하고, 파서 안에서 뱃지 텍스트와
// config.customParserArea를 비교해 나눈다.
// 날짜는 "기간: 2026.09.04~09.12"처럼 종료일에 연도·월이 생략돼 있어(시작일만
// 전체 YYYY.MM.DD), pohangTour.ts와 같은 방식으로 앞 조각의 연도를 이어받고
// 종료월이 시작월보다 작으면(연말→연초) 종료 연도에 1을 더한다.
const BASE_URL = "https://tour.jb.go.kr";

export function parseJbTour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".serchList .photoWrap").each((_index, element) => {
    const item = $(element);
    const area = item.find(".list_best_badge span").first().text().trim();
    if (area !== config.customParserArea) return;

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
