export interface ExhibitionVenue {
  lat: number;
  lng: number;
  address: string;
}

// 좌표는 학습 데이터 기반 근사치 — 배포 전 Kakao/Google Maps로 재검증할 것.
export const EXHIBITION_VENUES: Record<string, ExhibitionVenue> = {
  "코엑스": { lat: 37.512627, lng: 127.058678, address: "서울 강남구 영동대로 513" },
  "COEX": { lat: 37.512627, lng: 127.058678, address: "서울 강남구 영동대로 513" },
  "코엑스 마곡": { lat: 37.5601, lng: 126.83, address: "서울 강서구 마곡동" },
  "COEX Magok": { lat: 37.5601, lng: 126.83, address: "서울 강서구 마곡동" },
  "킨텍스": { lat: 37.668078, lng: 126.744528, address: "경기 고양시 일산서구 킨텍스로 217-6" },
  "KINTEX": { lat: 37.668078, lng: 126.744528, address: "경기 고양시 일산서구 킨텍스로 217-6" },
  "벡스코": { lat: 35.169275, lng: 129.13605, address: "부산 해운대구 APEC로 55" },
  "BEXCO": { lat: 35.169275, lng: 129.13605, address: "부산 해운대구 APEC로 55" },
  "송도컨벤시아": { lat: 37.389036, lng: 126.646195, address: "인천 연수구 센트럴로 123" },
  "Songdo ConvensiA": { lat: 37.389036, lng: 126.646195, address: "인천 연수구 센트럴로 123" },
  "aT센터": { lat: 37.4709, lng: 127.0378, address: "서울 서초구 강남대로 27" },
  "SETEC": { lat: 37.478, lng: 127.0653, address: "서울 강남구 남부순환로 3104" },
  "EXCO": { lat: 35.906759, lng: 128.612076, address: "대구 북구 엑스코로 10" },
  "엑스코": { lat: 35.906759, lng: 128.612076, address: "대구 북구 엑스코로 10" },
  "aT Center": { lat: 37.4709, lng: 127.0378, address: "서울 서초구 강남대로 27" },
  "대전컨벤션센터": { lat: 36.374991, lng: 127.391777, address: "대전 유성구 엑스포로 107" },
  "동대문디자인플라자": { lat: 37.5665, lng: 127.0093, address: "서울 중구 을지로 281" },
  "수원메쎄": { lat: 37.2519, lng: 126.9739, address: "경기 수원시 권선구 세화로134번길 37" },
  "수원컨벤션센터": { lat: 37.285664, lng: 127.059443, address: "경기 수원시 영통구 광교중앙로 140" },
  "창원컨벤션센터": { lat: 35.238588, lng: 128.656693, address: "경남 창원시 성산구 원이대로 362" },
  "김대중컨벤션센터": { lat: 35.14685, lng: 126.840262, address: "광주 서구 상무누리로 30" },
  "구미코": { lat: 36.1372, lng: 128.423, address: "경북 구미시 산동면 첨단기업1로 49" },
  "군산새만금컨벤션센터": { lat: 35.976, lng: 126.586, address: "전북 군산시 새만금북로 437" },
  "경주화백컨벤션센터": { lat: 35.8422, lng: 129.276, address: "경북 경주시 보문로 507" },
  "부산항국제전시컨벤션센터": { lat: 35.117705, lng: 129.049209, address: "부산 동구 충장대로 206" },
  "울산전시컨벤션센터": { lat: 35.5346, lng: 129.1006, address: "울산 울주군 삼남읍 울산역로 255" },
  "청주 오스코": { lat: 36.626439, lng: 127.335459, address: "충북 청주시 흥덕구 오송읍 오송생명로 250" },
};

export function resolveExhibitionVenue(venueText: string): ExhibitionVenue | null {
  const trimmed = venueText.trim();
  if (!trimmed) return null;

  const exact = EXHIBITION_VENUES[trimmed];
  if (exact) return exact;

  for (const [key, venue] of Object.entries(EXHIBITION_VENUES).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (trimmed.includes(key)) return venue;
  }
  return null;
}
