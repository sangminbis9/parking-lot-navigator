import type { AppConfig } from "../config/env.js";

const SEOUL_PAGE_SIZE = 1000;
const SEOUL_MAX_ROWS = 10000;

export interface SeoulParkInfoRow {
  PKLT_CD?: string;
  PKLT_NM?: string;
  ADDR?: string;
  LAT?: number;
  LOT?: number;
  TPKCT?: number;
  WD_OPER_BGNG_TM?: string;
  WD_OPER_END_TM?: string;
  CHGD_FREE_NM?: string;
  PRK_CRG?: number;
  PRK_HM?: number;
  ADD_CRG?: number;
  ADD_UNIT_TM_MNT?: number;
  PRK_NOW_INFO_PVSN_YN?: string;
}

interface SeoulParkInfoResponse {
  GetParkInfo?: {
    list_total_count?: number;
    row?: SeoulParkInfoRow[];
  };
}

async function fetchSeoulJson<T>(
  config: AppConfig,
  service: string,
  start: number,
  end: number
): Promise<T> {
  const url = `${config.SEOUL_OPEN_DATA_BASE_URL}/${config.SEOUL_OPEN_DATA_KEY}/json/${service}/${start}/${end}/`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`서울 열린데이터광장 호출 실패: ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchAllSeoulRows<TBody, TRow>(
  config: AppConfig,
  service: string,
  extract: (body: TBody) => { list_total_count?: number; row?: TRow[] } | undefined
): Promise<TRow[]> {
  const firstBody = await fetchSeoulJson<TBody>(config, service, 1, SEOUL_PAGE_SIZE);
  const firstResult = extract(firstBody);
  if (!firstResult) throw new Error(`서울 열린데이터광장 ${service} 응답 형식이 올바르지 않습니다.`);
  const firstRows = firstResult.row ?? [];
  const totalCount = Math.min(firstResult?.list_total_count ?? firstRows.length, SEOUL_MAX_ROWS);
  if (totalCount <= SEOUL_PAGE_SIZE) return firstRows;

  const ranges: Array<[number, number]> = [];
  for (let start = SEOUL_PAGE_SIZE + 1; start <= totalCount; start += SEOUL_PAGE_SIZE) {
    ranges.push([start, Math.min(start + SEOUL_PAGE_SIZE - 1, totalCount)]);
  }

  const remaining = await Promise.all(
    ranges.map(async ([start, end]) => {
      const body = await fetchSeoulJson<TBody>(config, service, start, end);
      const page = extract(body);
      if (!page?.row) {
        throw new Error(`서울 열린데이터광장 ${service} ${start}-${end} 구간 응답에 row가 없습니다.`);
      }
      return page.row;
    })
  );

  return [...firstRows, ...remaining.flat()];
}

// GetParkInfo는 실시간 provider(좌표)와 메타데이터 provider(요금·정원)가 같이 쓴다.
// 둘은 CompositeParkingProvider의 같은 Promise.all에서 출발하므로 진행 중인 fetch를
// 공유하면 페이지 최대 10건(subrequest)과 파싱된 행 배열 한 벌이 통째로 빠진다.
// 정산이 끝나면 참조를 놓아 회차 사이에 행을 붙들지 않는다.
let inFlightParkInfo: Promise<SeoulParkInfoRow[]> | null = null;

export function fetchSeoulParkInfoRows(config: AppConfig): Promise<SeoulParkInfoRow[]> {
  if (!inFlightParkInfo) {
    inFlightParkInfo = fetchAllSeoulRows<SeoulParkInfoResponse, SeoulParkInfoRow>(
      config,
      "GetParkInfo",
      (body) => body.GetParkInfo
    ).finally(() => {
      inFlightParkInfo = null;
    });
  }
  return inFlightParkInfo;
}
