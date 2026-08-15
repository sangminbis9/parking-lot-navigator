import { describe, expect, it } from "vitest";
import { isRetryableBackfillError } from "../src/backfillRetry.js";

describe("isRetryableBackfillError", () => {
  it("HTTP 429/5xx는 재시도한다", () => {
    expect(isRetryableBackfillError("TourAPI detail failed: 429")).toBe(true);
    expect(isRetryableBackfillError("KOPIS detail API failed: 503")).toBe(true);
    expect(isRetryableBackfillError("TourAPI detail failed: 500")).toBe(true);
  });

  it("HTTP 4xx는 같은 id로 다시 불러도 같으므로 확정한다", () => {
    expect(isRetryableBackfillError("TourAPI detail failed: 400")).toBe(false);
    expect(isRetryableBackfillError("KOPIS detail API failed: 404")).toBe(false);
  });

  it("일시적 resultCode 오류는 재시도한다", () => {
    expect(
      isRetryableBackfillError(
        "TourAPI detail failed: LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR",
      ),
    ).toBe(true);
    expect(
      isRetryableBackfillError(
        "TourAPI detail failed: SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
      ),
    ).toBe(true);
    expect(
      isRetryableBackfillError("TourAPI detail failed: SERVICETIME_OUT"),
    ).toBe(true);
  });

  it("데이터 없음(NODATA)은 확정한다", () => {
    expect(
      isRetryableBackfillError("TourAPI detail failed: NODATA_ERROR"),
    ).toBe(false);
    expect(
      isRetryableBackfillError("TourAPI detail failed: NO_DATA_ERROR"),
    ).toBe(false);
  });

  it("subrequest 초과와 분류 불가 오류는 재시도한다", () => {
    expect(
      isRetryableBackfillError(
        "Too many subrequests by single Worker invocation",
      ),
    ).toBe(true);
    expect(
      isRetryableBackfillError("The operation was aborted due to timeout"),
    ).toBe(true);
    expect(isRetryableBackfillError("Network connection lost")).toBe(true);
  });
});
