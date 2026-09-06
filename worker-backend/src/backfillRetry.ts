// backfill(요금·사진)이 detail API 호출에 실패했을 때, 그 실패를 "다음 회차에
// 다시 시도"와 "이 id로는 영구 실패"로 가른다. 잘못 가르면 양쪽 다 손해다:
// 일시적 실패를 확정하면 checked_at이 찍혀 그 행의 데이터를 영구히 잃고,
// 영구 실패를 재시도하면 같은 행에 subrequest 예산을 무한히 갉아먹는다.
// 판별할 수 없는 실패는 재시도 쪽으로 둔다 — 예산 낭비는 회차당 상한으로
// 막히지만, 잘못된 확정은 수동 UPDATE 없이는 되돌릴 수 없다.

// TourAPI(공공데이터포털)는 HTTP 200으로 resultCode 오류를 돌려주므로 상태코드가
// 메시지에 없다. 그중 같은 id로 다시 불러도 결과가 바뀌지 않는 것은 "데이터 없음"
// 계열뿐이다. 쿼터 초과(LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR),
// 키 미등록/정지, 서비스 타임아웃은 시간이 지나면 풀리므로 재시도 대상이다.
const PERMANENT_RESULT_PATTERNS = [/NODATA/i, /NO_DATA/i];

export function isRetryableBackfillError(message: string): boolean {
  if (message.includes("Too many subrequests")) return true;
  const status = /failed: (\d{3})\b/.exec(message)?.[1];
  if (status) return status === "429" || Number(status) >= 500;
  if (PERMANENT_RESULT_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  // 타임아웃·네트워크 오류처럼 분류 근거가 없는 실패는 일시적으로 본다.
  return true;
}

/**
 * 대상 선정 SQL에서 "아직 안 끝난 행사"를 가리는 식.
 *
 * 예전에는 `(end_date IS NULL OR end_date >= ?)`였는데, 이 OR는 인덱스 범위로
 * 쓸 수 없어 요금·프로그램 대상 선정이 매번 해당 source 전체를 훑었다
 * (2026-09-06 실측: 요금 5,628행/회차 × 61회 = 343,334행/일).
 * COALESCE로 항을 하나로 만들면 같은 식을 키로 가진 인덱스가 범위를 탈 수 있다.
 *
 * `migrations/0031_d1_backfill_scan_indexes.sql`의 인덱스 식과 **문자 그대로**
 * 같아야 한다. SQLite는 표현식 인덱스를 쓸 때 구조가 일치하는 항만 매칭한다.
 */
export const FUTURE_END_DATE_EXPR = "COALESCE(end_date, '9999-12-31')";
