export interface CityFestivalAudit {
  siteId: string;
  checkedAt: string;
  status: "ok" | "site_failed" | "write_failed";
  candidates: number;
  missingTitle: number;
  invalidDate: number;
  belowThreshold: number;
  fallbackCoordinates: number;
  accepted: number;
  written: number;
  parserDiagnostics?: { seen: number; missingTitle: number; missingPeriod: number; missingVenue: number };
}

/** Private operational counters only: no payloads, credentials or added D1 reads.
 * CAS prevents a delayed concurrent run overwriting a more recent observation.
 */
export async function saveCityFestivalAudit(bucket: R2Bucket, audit: CityFestivalAudit): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(audit.siteId)) throw new Error("invalid_audit_site_id");
  const key = `internal/source-audit/${audit.siteId}.json`;
  const object = await bucket.get(key);
  const previous = object ? await object.json<{ checkedAt: string; lastSuccessAt?: string; emptyResultStreak?: number }>() : null;
  if (previous && Date.parse(previous.checkedAt) > Date.parse(audit.checkedAt)) return;
  const emptyResultStreak = audit.status === "ok" && audit.written === 0
    ? Math.min((previous?.emptyResultStreak ?? 0) + 1, 1000000) : 0;
  await bucket.put(key, JSON.stringify({ schemaVersion: 1, ...audit,
    lastSuccessAt: audit.status === "ok" ? audit.checkedAt : previous?.lastSuccessAt ?? null,
    emptyResultStreak }), { onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: "*" } });
}
