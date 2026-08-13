// 축제/공연/박람회 요금 문구는 소스마다 필드도 표기도 제각각이다(TourAPI
// usetimefestival, KOPIS pcseguidance, 서울 열린데이터 USE_FEE ...).
// 저장 시점에 여기서 한 번 정규화해, D1에는 항상 같은 모양의 문구와
// 무료/유료 플래그가 들어가게 한다.

export type FeeType = "free" | "paid" | "unknown";

export interface NormalizedFee {
  feeType: FeeType;
  feeText: string | null;
}

const MAX_FEE_TEXT_LENGTH = 300;

// "5,000원", "10000 원"처럼 금액이 적혀 있으면 무료 문구가 함께 있어도 유료다
// ("성인 5,000원 / 어린이 무료").
const AMOUNT_PATTERN = /\d[\d,]*\s*원/;
const PAID_WORD_PATTERN = /유료|입장료\s*있음|관람료\s*있음|티켓\s*구매|예매\s*필수/;

// "65세 이상 무료", "청소년 무료"처럼 특정 대상에게만 무료인 문구는 전체
// 무료의 근거가 될 수 없다. 걷어낸 뒤에도 무료 언급이 남아야 free로 본다.
const CONDITIONAL_FREE_PATTERN =
  /(?:(?:만\s?)?\d{1,2}\s?세\s?(?:이상|이하|미만|초과)|청소년|어린이|유아|미취학(?:\s?아동)?|경로\s?우대\S{0,3}|국가유공자|장애인|다자녀(?:\s?가정)?|임산부|군인|학생)[^,./\n]{0,12}무료/g;
const FREE_PATTERN = /무료|무료입장|없음|free/i;

// "입장료 0원"처럼 금액 자리에 0이 적힌 것도 무료 표기다.
const ZERO_AMOUNT_PATTERN = /(^|\D)0\s*원/;

export function normalizeFee(raw: string | null | undefined): NormalizedFee {
  const feeText = cleanFeeText(raw);
  if (!feeText) return { feeType: "unknown", feeText: null };
  // "0원"은 금액이 아니라 무료 표기다.
  const withoutZero = feeText.replace(/(^|\D)0\s*원/g, "$1");
  if (AMOUNT_PATTERN.test(withoutZero) || PAID_WORD_PATTERN.test(feeText)) {
    return { feeType: "paid", feeText };
  }
  const unconditional = feeText.replace(CONDITIONAL_FREE_PATTERN, " ");
  if (FREE_PATTERN.test(unconditional) || ZERO_AMOUNT_PATTERN.test(feeText)) {
    return { feeType: "free", feeText };
  }
  return { feeType: "unknown", feeText };
}

// is_free 컬럼값. 판별 불가는 NULL로 남겨, "유료"와 "모름"을 섞지 않는다.
export function feeFreeFlag(fee: NormalizedFee): 1 | 0 | null {
  if (fee.feeType === "free") return 1;
  if (fee.feeType === "paid") return 0;
  return null;
}

function cleanFeeText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_FEE_TEXT_LENGTH
    ? `${text.slice(0, MAX_FEE_TEXT_LENGTH).trimEnd()}…`
    : text;
}
