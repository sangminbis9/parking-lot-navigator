/// 서버는 UTC로 돌지만 이 앱이 다루는 날짜(행사 시작일, 집계 기준일, 알림 기준일)는
/// 전부 Asia/Seoul 기준이다. 같은 +9시간 변환이 파일마다 kstToday/kstDay/seoulDayString
/// 세 이름으로 복제돼 있었다. 한국은 서머타임이 없어 고정 오프셋으로 충분하다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** now를 Asia/Seoul 기준 "yyyy-MM-dd"로. */
export function seoulDayString(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** now의 Asia/Seoul 기준 시(0-23). */
export function seoulHour(now: Date): number {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
}
