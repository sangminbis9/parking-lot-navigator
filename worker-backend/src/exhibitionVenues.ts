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
  "송도컨벤시아": { lat: 37.39018, lng: 126.657367, address: "인천 연수구 센트럴로 123" },
  "Songdo ConvensiA": { lat: 37.39018, lng: 126.657367, address: "인천 연수구 센트럴로 123" },
  "aT센터": { lat: 37.4709, lng: 127.0378, address: "서울 서초구 강남대로 27" },
  "SETEC": { lat: 37.478, lng: 127.0653, address: "서울 강남구 남부순환로 3104" },
  "EXCO": { lat: 35.89231, lng: 128.62278, address: "대구 북구 엑스코로 10" },
  "엑스코": { lat: 35.89231, lng: 128.62278, address: "대구 북구 엑스코로 10" },
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
