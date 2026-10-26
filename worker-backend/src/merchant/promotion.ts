/** 무료 게시 마지막 날. 한국 시간으로 해당 날짜가 끝날 때까지 적용한다. */
export const FREE_REGISTRATION_LAST_DAY = "2027-06-30";
export const FREE_REGISTRATION_LAST_DAY_LABEL = "2027년 6월 30일";
export const PAID_REGISTRATION_START_LABEL = "2027년 7월부터";

export function launchPromoEnabled(
  env: { MERCHANT_LAUNCH_PROMO_FREE?: string },
  now = new Date(),
): boolean {
  const raw = (env.MERCHANT_LAUNCH_PROMO_FREE ?? "").trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(raw)) return false;
  const koreaDay = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return koreaDay <= FREE_REGISTRATION_LAST_DAY;
}
