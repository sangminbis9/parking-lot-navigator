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
export class DetailFetchBudget {
  private remaining: number;

  constructor(limit: number) {
    this.remaining = limit;
  }

  tryConsume(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}
