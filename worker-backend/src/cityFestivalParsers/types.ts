export interface RawCityFestivalCandidate {
  title: string | null;
  startDateRaw: string | null;
  endDateRaw: string | null;
  venueRaw: string | null;
  addressRaw: string | null;
  detailUrl: string | null;
  imageUrl: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface CitySiteConfig {
  siteId: string;
  cityName: string;
  listUrl: string;
  fallbackLat: number;
  fallbackLng: number;
  robotsCheckedAt: string;
  selectors?: {
    itemSelector: string;
    titleSelector: string;
    dateSelector: string;
    linkSelector: string;
    imageSelector?: string;
    venueSelector?: string;
    addressSelector?: string;
    // 목록 페이지에는 위치 정보가 없고 상세 페이지에만 있는 사이트용. 지정되면
    // 후보마다 detailUrl을 추가로 fetch해 이 셀렉터로 venue/address를 채운다.
    detailVenueSelector?: string;
    detailAddressSelector?: string;
  };
  customParser?: string;
  // customParser가 하나의 listUrl을 공유하는 여러 site config를 구분할 때 쓰는
  // 범용 파라미터(예: 경북 wave의 cd_area 코드). customParser별로 의미가 다르다.
  customParserArea?: string;
  fetchMethod?: "GET" | "POST";
  fetchBody?: string;
  fetchReferer?: string;
}

// 상세 페이지 fetch(detailVenueSelector/detailAddressSelector, jbTour 등)는
// 후보 하나당 최대 1회씩 추가 fetch를 낸다. Cloudflare Workers는 invocation당
// 보낼 수 있는 subrequest 개수에 한도가 있고, 15개 사이트가 함께 도는 한
// chunk 안에서 이 fetch가 누적되면 뒤에 처리되는 사이트가 list-page fetch부터
// "Too many subrequests" 에러로 통째로 실패한다(2026-08-09 wrangler tail로
// 확인). runCityFestivalDiscovery()가 invocation마다 하나씩 만들어 모든
// 사이트/파서가 공유하는 예산으로 상세 페이지 fetch 총량을 제한한다.
// 전체 예산을 순서대로(FIFO) 소진하면 사이트 배열에서 앞선 사이트(예: 인천
// 연수구 후보 13건)가 예산을 거의 다 가져가 뒤에 오는 사이트(제물포 12건 등)는
// 단 한 건도 상세 페이지를 못 읽고 전부 fallback 좌표에 몰린다(2026-08-09
// 실측). siteId별 상한을 둬 한 사이트가 예산을 독점하지 못하게 막는다.
export class DetailFetchBudget {
  private remaining: number;
  private readonly perSiteCap: number;
  private readonly perSiteConsumed = new Map<string, number>();

  constructor(limit: number, perSiteCap: number = limit) {
    this.remaining = limit;
    this.perSiteCap = perSiteCap;
  }

  tryConsume(siteId?: string): boolean {
    if (this.remaining <= 0) return false;
    if (siteId) {
      const used = this.perSiteConsumed.get(siteId) ?? 0;
      if (used >= this.perSiteCap) return false;
    }
    this.remaining -= 1;
    if (siteId) this.perSiteConsumed.set(siteId, (this.perSiteConsumed.get(siteId) ?? 0) + 1);
    return true;
  }
}

// 상세 페이지 fetch를 Promise.all로 한꺼번에 origin에 쏘면 서버가 burst를
// 못 버텨 대부분 실패한다(2026-08-09 인천 itour 연수구 실측: 13건 동시 요청
// 시 9건 실패, fallback 좌표로 남음). 소규모씩 나눠 순차 배치로 처리해
// origin 부하를 줄인다.
export const DETAIL_FETCH_CONCURRENCY = 3;

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}
