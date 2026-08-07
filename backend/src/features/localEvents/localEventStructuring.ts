import type { LocalEventType, StructuredLocalEventResult } from "@parking/shared-types";

interface StructureInput {
  sourceUrl?: string | null;
  captionText?: string | null;
  storeName?: string | null;
  address?: string | null;
  now?: Date;
}

// "65세 이상 무료", "청소년 무료입장"처럼 특정 대상에게만 무료인 문구를
// 다른 패턴보다 먼저 매칭해 조건을 포함한 전체 문구를 benefit으로 남긴다.
// 이 패턴이 없으면 뒤의 `/(무료...)/` 패턴이 조건 부분을 버리고 "무료"만
// 추출해, 전체 무료가 아닌 이벤트가 무조건 무료처럼 보이는 문제가 있었다.
export const AGE_CONDITIONAL_FREE_PATTERN =
  /((?:(?:만\s?)?\d{1,2}\s?세\s?(?:이상|이하|미만|초과)|청소년|어린이|미취학(?:아동)?|경로\s?우대\S{0,3}|국가유공자|장애인|다자녀(?:\s?가정)?|임산부)[^\n.]{0,12}무료)/i;

// "무료 주차", "주차비 무료", "무료 배송"처럼 핵심 혜택과 무관하게 곁다리로
// 언급되는 부가 서비스 안내는 이벤트 본연의 혜택이 아니므로 freebie 판단
// 근거로 삼지 않는다. 이게 없으면 "50% 할인 ... 무료 배송" 같은 할인
// 게시물이 부가 서비스 문구 때문에 freebie로 잘못 분류된다.
export const INCIDENTAL_FREE_PATTERN =
  /((?:무료\s?(?:주차|발렛|배송|택배|와이파이|wifi)|주차\s?(?:비)?\s?무료|배송\s?(?:비)?\s?무료))/gi;

const benefitPatterns = [
  AGE_CONDITIONAL_FREE_PATTERN,
  /(\d{1,2}\s?%\s?(?:할인|discount))/i,
  /(무료\s?(?:제공|증정|시식|음료|쿠폰)?)/i,
  /(1\s*\+\s*1|원\s?\+\s?원)/i,
  /(리뷰\s?(?:이벤트|작성|인증)[^\n.]*)/i,
  /(방문\s?(?:이벤트|인증)[^\n.]*)/i
];

// AGE_CONDITIONAL_FREE_PATTERN에 해당하는 조건부 무료 문구를 걷어낸 뒤에도
// "무료"가 남아 있는지로, 대상 제한 없는 무료 언급이 따로 있는지 판별한다.
export function hasUnconditionalFreeMention(text: string): boolean {
  const stripped = text
    .replace(new RegExp(AGE_CONDITIONAL_FREE_PATTERN.source, "gi"), "")
    .replace(INCIDENTAL_FREE_PATTERN, "");
  return /무료/i.test(stripped);
}

export function structureLocalEvent(input: StructureInput): StructuredLocalEventResult {
  const text = normalizeText(input.captionText);
  const storeName = clean(input.storeName) ?? extractStoreName(text);
  const title = extractTitle(text, storeName);
  const benefit = extractBenefit(text);
  const dates = extractDateRange(text, input.now ?? new Date());
  const address = clean(input.address) ?? null;
  const confidenceScore = scoreStructuredResult({ title, benefit, storeName, address, endDate: dates.endDate });

  return {
    title,
    description: text || null,
    benefit,
    startDate: dates.startDate,
    endDate: dates.endDate,
    storeName,
    address,
    lat: null,
    lng: null,
    sourceUrl: input.sourceUrl ?? null,
    confidenceScore,
    needsReview: confidenceScore < 0.75 || !dates.endDate || !address
  };
}

export function inferLocalEventType(text: string | null | undefined): LocalEventType {
  const normalized = normalizeText(text).toLowerCase();
  if (/(팝업|popup)/i.test(normalized)) return "popup";
  if (/(리뷰|review)/i.test(normalized)) return "review_event";
  if (/(증정|freebie|gift)/i.test(normalized)) return "freebie";
  if (/무료/i.test(normalized) && hasUnconditionalFreeMention(normalized)) return "freebie";
  if (/(할인|discount|쿠폰|coupon)/i.test(normalized)) return "discount";
  if (/(한정|limited|시즌|season)/i.test(normalized)) return "limited_menu";
  if (/(오픈|개업|opening)/i.test(normalized)) return "opening_event";
  return "etc";
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clean(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function extractTitle(text: string, storeName: string | null): string | null {
  if (!text && storeName) return `${storeName} event`;
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim();
  if (firstSentence && firstSentence.length <= 80) return firstSentence;
  if (storeName) return `${storeName} event`;
  return null;
}

function extractStoreName(text: string): string | null {
  const match = text.match(/(?:매장|상호|store)\s*[:：]\s*([^\n,]+)/i);
  return clean(match?.[1]);
}

function extractBenefit(text: string): string | null {
  for (const pattern of benefitPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractDateRange(text: string, now: Date): { startDate: string | null; endDate: string | null } {
  const isoRange = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2}).{0,10}?(\d{4})?[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (isoRange) {
    const startYear = isoRange[1];
    const endYear = isoRange[4] ?? startYear;
    return {
      startDate: formatDate(Number(startYear), Number(isoRange[2]), Number(isoRange[3])),
      endDate: formatDate(Number(endYear), Number(isoRange[5]), Number(isoRange[6]))
    };
  }

  const koreanRange = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일.{0,10}?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (koreanRange) {
    const year = now.getFullYear();
    return {
      startDate: formatDate(year, Number(koreanRange[1]), Number(koreanRange[2])),
      endDate: formatDate(year, Number(koreanRange[3]), Number(koreanRange[4]))
    };
  }

  const monthOnly = text.match(/(\d{1,2})\s*월\s*한정/);
  if (monthOnly) {
    const year = now.getFullYear();
    const month = Number(monthOnly[1]);
    return {
      startDate: formatDate(year, month, 1),
      endDate: null
    };
  }

  if (/오늘까지/.test(text)) {
    const today = formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return { startDate: today, endDate: today };
  }

  return { startDate: null, endDate: null };
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function scoreStructuredResult(value: {
  title: string | null;
  benefit: string | null;
  storeName: string | null;
  address: string | null;
  endDate: string | null;
}): number {
  let score = 0;
  if (value.title) score += 0.2;
  if (value.benefit) score += 0.2;
  if (value.storeName) score += 0.2;
  if (value.address) score += 0.2;
  if (value.endDate) score += 0.2;
  return Number(score.toFixed(2));
}
