export function normalizeFeeSummaryText(value: string | null): string | null {
  const text = clean(value);
  if (!text) return null;

  return text
    .replace(/\bbase\s+(\d+(?:\.\d+)?)min\s+([\d,]+)\s+KRW\b/gi, (_, minutes: string, charge: string) => {
      return `기본 ${formatMinutes(minutes)} ${formatWon(charge)}`;
    })
    .replace(/\bextra\s+(\d+(?:\.\d+)?)min\s+([\d,]+)\s+KRW\b/gi, (_, minutes: string, charge: string) => {
      return `추가 ${formatMinutes(minutes)} ${formatWon(charge)}`;
    })
    .replace(/\bday\s+([\d,]+)\s+KRW\b/gi, (_, charge: string) => `일 최대 ${formatWon(charge)}`)
    .replace(/\bmonth\s+([\d,]+)\s+KRW\b/gi, (_, charge: string) => `월 정기권 ${formatWon(charge)}`)
    .replace(/\bpaid\b/gi, "유료")
    .replace(/\bfree\b/gi, "무료");
}

export function normalizeOperatingHoursText(value: string | null): string | null {
  const text = clean(value);
  if (!text) return null;

  return text
    .replace(/\bweekday\s+/gi, "평일 ")
    .replace(/\bsat\s+/gi, "토요일 ")
    .replace(/\bholiday\s+/gi, "공휴일 ");
}

function clean(value: string | null): string | null {
  const text = value?.trim();
  return text && text.length > 0 ? text : null;
}

function formatMinutes(value: string): string {
  const number = Number(value);
  return Number.isInteger(number) ? `${number}분` : `${value}분`;
}

function formatWon(value: string): string {
  const number = Number(value.replaceAll(",", ""));
  return Number.isFinite(number) ? `${number.toLocaleString("ko-KR")}원` : `${value}원`;
}
