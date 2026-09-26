import type { Festival } from "@parking/shared-types";
import {
  clusterFestivals,
  FESTIVAL_MERGE_FIELDS,
  festivalDedupeKey,
  isRegionFallbackCoordinate,
  mapFestivalRow,
  pickCanonicalFestival,
  wordOrderInvariantKey,
  type DiscoveryItemRow,
} from "./discoveryCache.js";
import { validCoordinate } from "./discoverySnapshot.js";

// 같은 축제를 여러 provider가 따로 보내면 discovery_items에 행이 여러 개 생긴다.
// /api/festivals는 응답을 만들 때 dedupeFestivals로 합치지만, 스냅샷은 id 해시 버킷별로
// part를 만들기 때문에 같은 묶음이 서로 다른 part에 흩어져 앱에 중복 핀이 뜬다.
// 이 job이 묶음 결과를 행에 적는다(migration 0034):
//   흡수된 행 → merged_into = 대표 행 id (스냅샷 festivals에서 빠진다)
//   대표 행   → merge_donors_json = 흡수한 행들의 공개 필드 (스냅샷이 mergeFestivalFields로 합친다)
// 행은 지우지 않고, 값이 실제로 바뀐 행만 UPDATE한다.
//
// Worker 무료 플랜 CPU 10ms 안에 끝나야 한다. 전 행(8천여 건)을 매회 제목 정규화·묶음하면
// 25~50ms가 들어 invocation이 조용히 죽는다. 그래서
//   1) 제목 키를 행에 저장해 두고(migration 0035) SQL 창 함수로 "같은 키를 가진 진행/예정 행이
//      둘 이상"인 후보와 이미 병합 표시가 있는 행만 읽는다.
//   2) 표시가 이미 맞는 묶음은 건드리지 않는다. 전체 행(raw_payload)을 읽어 대표를 다시 고르는 것은
//      표시가 어긋난 묶음과, donor 내용 변화를 반영하려고 하루 한 번 도는 순번 몫뿐이고
//      회차당 MAX_CLUSTERS_PER_RUN개로 자른다. 남은 것은 다음 회차가 이어받는다.

interface MergeKeyRow {
  id: string;
  source: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  lat: number | null;
  lng: number | null;
  merge_title_key: string | null;
  merge_word_key: string | null;
  merged_into: string | null;
  has_donors: number;
  live: number;
}

interface MergeTarget {
  mergedInto: string | null;
  donorsJson: string | null;
}

// D1 bind 인자 상한(100) 안에서 IN 목록과 batch를 나눈다.
const CHUNK = 50;
// 키 계산은 행마다 정규식 수십 번이라 한 회차 몫을 자른다.
const FILL_LIMIT = 400;
const MAX_CLUSTERS_PER_RUN = 20;

// ?1 = 오늘(KST). 끝난 행사는 스냅샷에 있어도 앱이 걸러 내므로 새로 묶지 않는다.
const CANDIDATE_QUERY = `
SELECT id, source, title, start_date, end_date, lat, lng, merge_title_key, merge_word_key,
       merged_into, has_donors, live
  FROM (
    SELECT id, source, title, start_date, end_date, lat, lng, merge_title_key, merge_word_key,
           merged_into,
           merge_donors_json IS NOT NULL AS has_donors,
           COALESCE(end_date, start_date) >= ?1 AS live,
           SUM(COALESCE(end_date, start_date) >= ?1) OVER (PARTITION BY merge_title_key) AS title_count,
           SUM(COALESCE(end_date, start_date) >= ?1) OVER (PARTITION BY merge_word_key) AS word_count
      FROM discovery_items
     WHERE type = 'festival'
  )
 WHERE merged_into IS NOT NULL OR has_donors
    OR (live AND (merge_title_key IS NULL OR title_count > 1 OR word_count > 1))
 ORDER BY id`;

export interface FestivalMergeResult {
  rows: number;
  keysFilled: number;
  clusters: number;
  recomputed: number;
  mergedRows: number;
  updated: number;
}

export async function runFestivalMerge(db: D1Database, now = new Date()): Promise<FestivalMergeResult> {
  const today = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const { results: rows } = await db.prepare(CANDIDATE_QUERY).bind(today).all<MergeKeyRow>();
  const result: FestivalMergeResult = {
    rows: rows.length,
    keysFilled: 0,
    clusters: 0,
    recomputed: 0,
    mergedRows: 0,
    updated: 0,
  };

  const keyOf = (row: MergeKeyRow) => ({
    row,
    title: row.title,
    source: row.source,
    lat: row.lat!,
    lng: row.lng!,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? row.start_date ?? "",
    titleKey: row.merge_title_key ?? undefined,
    wordKey: row.merge_word_key ?? undefined,
  });

  // 키가 빈 행(새 행·제목이 바뀐 행)을 먼저 채운다. 이번 조회의 창 함수 집계에는 그 행들이
  // 빠져 있어 짝을 놓칠 수 있으므로, 채운 회차는 묶지 않고 다음 회차에 맡긴다.
  const missing = rows.filter((row) => row.live && row.merge_title_key === null).slice(0, FILL_LIMIT);
  if (missing.length > 0) {
    const fills = missing.map((row) =>
      db
        .prepare("UPDATE discovery_items SET merge_title_key = ?, merge_word_key = ? WHERE id = ?")
        .bind(festivalDedupeKey(keyOf(row)), wordOrderInvariantKey(row.title), row.id),
    );
    for (let i = 0; i < fills.length; i += CHUNK) await db.batch(fills.slice(i, i + CHUNK));
    result.keysFilled = fills.length;
    return result;
  }

  // 스냅샷에 들어가는 행과 같은 기준으로 거른다(좌표 없음·지역 대표 좌표는 스냅샷에서 빠짐).
  const keys = rows
    .filter((row) => validCoordinate(row.lat, row.lng) && !isRegionFallbackCoordinate(row.lat!, row.lng!))
    .map(keyOf);
  const multi = clusterFestivals(keys)
    .filter((cluster) => cluster.length > 1)
    .map((cluster) => cluster.map((key) => key.row));
  result.clusters = multi.length;

  const pointers = new Map<string, number>();
  for (const row of rows) {
    if (row.merged_into) pointers.set(row.merged_into, (pointers.get(row.merged_into) ?? 0) + 1);
  }
  // 대표 하나가 donor 목록을 갖고, 나머지 전원이 그 대표를 가리키며, 묶음 밖에서 그 대표를
  // 가리키는 행이 없으면 표시가 맞다.
  const consistent = (members: MergeKeyRow[]) => {
    const heads = members.filter((row) => !row.merged_into && row.has_donors);
    if (heads.length !== 1) return false;
    const head = heads[0];
    return (
      members.every((row) => row === head || row.merged_into === head.id) &&
      pointers.get(head.id) === members.length - 1
    );
  };
  const hour = now.getUTCHours();
  const stale = multi.filter((members) => !consistent(members));
  const refresh = multi.filter(
    (members) => consistent(members) && members.some((row) => row.live) && refreshHour(members) === hour,
  );
  const recompute = [...stale, ...refresh].slice(0, MAX_CLUSTERS_PER_RUN);
  result.recomputed = recompute.length;

  // 여러 건짜리 묶음에 들지 못한 표시 행(제목·기간이 바뀌었거나 상대 행이 사라짐)은 표시를 지운다.
  const clustered = new Set(multi.flat().map((row) => row.id));
  const updates = rows
    .filter((row) => !clustered.has(row.id) && (row.merged_into || row.has_donors))
    .map((row) =>
      db
        .prepare("UPDATE discovery_items SET merged_into = NULL, merge_donors_json = NULL WHERE id = ?")
        .bind(row.id),
    );

  // 다시 계산할 묶음만 전체 행을 읽어 대표를 고른다.
  const fullRows = new Map<string, DiscoveryItemRow>();
  const ids = recompute.flat().map((row) => row.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { results } = await db
      .prepare(`SELECT * FROM discovery_items WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<DiscoveryItemRow>();
    for (const row of results) fullRows.set(row.id, row);
  }

  for (const cluster of recompute) {
    const members = cluster
      .map((row) => fullRows.get(row.id))
      .filter((row): row is DiscoveryItemRow => row !== undefined);
    if (members.length < 2) continue;
    const festivals = members.map((row) => mapFestivalRow(row, row.lat, row.lng));
    const canonical = pickCanonicalFestival(festivals);
    const canonicalRow = members[festivals.indexOf(canonical)];
    const targets = new Map<string, MergeTarget>();
    const payloads: Partial<Festival>[] = [];
    members.forEach((row, index) => {
      if (row === canonicalRow) return;
      payloads.push(mergePayload(festivals[index]));
      targets.set(row.id, { mergedInto: canonicalRow.id, donorsJson: null });
    });
    targets.set(canonicalRow.id, { mergedInto: null, donorsJson: JSON.stringify(payloads) });
    result.mergedRows += members.length - 1;
    for (const row of members) {
      const target = targets.get(row.id)!;
      if ((row.merged_into ?? null) === target.mergedInto && (row.merge_donors_json ?? null) === target.donorsJson) {
        continue;
      }
      updates.push(
        db
          .prepare("UPDATE discovery_items SET merged_into = ?, merge_donors_json = ? WHERE id = ?")
          .bind(target.mergedInto, target.donorsJson, row.id),
      );
    }
  }

  for (let i = 0; i < updates.length; i += CHUNK) await db.batch(updates.slice(i, i + CHUNK));
  result.updated = updates.length;
  return result;
}

// 표시가 맞는 묶음도 donor의 사진·설명이 나중에 바뀔 수 있어 하루 한 번(UTC 시 순번) 다시 계산한다.
function refreshHour(members: MergeKeyRow[]): number {
  const id = members.reduce((min, row) => (row.id < min ? row.id : min), members[0].id);
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 24;
}

// 스냅샷은 공개 DTO만 담으므로 여기서도 Festival의 병합 대상 필드만 남긴다(raw_payload 금지).
function mergePayload(festival: Festival): Partial<Festival> {
  const payload: Record<string, unknown> = {};
  for (const field of FESTIVAL_MERGE_FIELDS) {
    const value = festival[field];
    if (value == null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    payload[field] = value;
  }
  return payload as Partial<Festival>;
}
