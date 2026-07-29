import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 포항문화재단(phcf.or.kr)은 HTML 목록 페이지가 아니라 JSON을 반환하는
// getList.do API로 축제 데이터를 제공한다(2026-07-29 curl 실측, 응답은
// 래핑 없는 순수 배열). FESTIVAL_PERIOD 값이 "2026년 6월 13일"(단일일자),
// "2025년 12월 31일~2026년 1월 1일"(양쪽 모두 연도 포함),
// "11월 7일~13일"(연도·둘째 조각의 월 모두 생략) 세 가지 형태가 섞여 있어
// cityFestivalNormalize.ts의 공용 날짜 정규식이 바로 인식하지 못하는
// 경우가 있다. FESTIVAL_YEAR를 폴백 연도로, 앞 조각의 월을 폴백 월로 써서
// "YYYY-MM-DD ~ YYYY-MM-DD" 형태로 재구성한다.
// 상세 페이지 경로(FESTIVAL_ID 기반 view URL)와 포스터 이미지 경로는
// 2026-07-29 조사에서 확인하지 못해(관련 페이지가 모두 404) 억지로
// 추측하지 않고 재단 홈페이지로 폴백/null 처리한다.
const DETAIL_FALLBACK = "https://www.phcf.or.kr/";

interface PohangFestivalItem {
  FESTIVAL_NAME: string | null;
  FESTIVAL_PERIOD: string | null;
  FESTIVAL_YEAR: number | null;
  MAIN_VENUE: string | null;
}

export function parsePohangTour(
  json: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results: RawCityFestivalCandidate[] = [];
  for (const raw of parsed as PohangFestivalItem[]) {
    const title = raw.FESTIVAL_NAME || null;
    if (!title) continue;

    const fallbackYear = raw.FESTIVAL_YEAR ?? new Date().getFullYear();
    const dateText = normalizePeriodText(raw.FESTIVAL_PERIOD, fallbackYear);

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw: raw.MAIN_VENUE || null,
      addressRaw: null,
      detailUrl: DETAIL_FALLBACK,
      imageUrl: null
    });
  }

  return results;
}

// "11월 7일~13일"처럼 연도나 월이 생략된 조각은 이전 조각에서 파싱한
// 연도/월을 이어받는다. 아무 것도 못 뽑으면 null을 돌려줘 호출부가
// 해당 항목을 제외하게 한다(추측으로 날짜를 채우지 않음).
function normalizePeriodText(period: string | null, fallbackYear: number): string | null {
  if (!period) return null;
  const parts = period.split("~").map((part) => part.trim());

  let lastYear = fallbackYear;
  let lastMonth: number | null = null;
  const normalized: string[] = [];

  for (const part of parts) {
    const full = part.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (full) {
      lastYear = Number(full[1]);
      lastMonth = Number(full[2]);
      normalized.push(`${lastYear}-${pad(lastMonth)}-${pad(Number(full[3]))}`);
      continue;
    }

    const monthDay = part.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (monthDay) {
      lastMonth = Number(monthDay[1]);
      normalized.push(`${lastYear}-${pad(lastMonth)}-${pad(Number(monthDay[2]))}`);
      continue;
    }

    const dayOnly = part.match(/(\d{1,2})\s*일/);
    if (dayOnly && lastMonth !== null) {
      normalized.push(`${lastYear}-${pad(lastMonth)}-${pad(Number(dayOnly[1]))}`);
    }
  }

  return normalized.length > 0 ? normalized.join(" ~ ") : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
