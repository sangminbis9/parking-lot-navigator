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
  };
  customParser?: string;
  // customParser가 하나의 listUrl을 공유하는 여러 site config를 구분할 때 쓰는
  // 범용 파라미터(예: 경북 wave의 cd_area 코드). customParser별로 의미가 다르다.
  customParserArea?: string;
  fetchMethod?: "GET" | "POST";
  fetchBody?: string;
  fetchReferer?: string;
}
