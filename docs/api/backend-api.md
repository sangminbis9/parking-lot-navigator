# 백엔드 API 문서

## GET /search/destination

목적지 문자열을 좌표 후보로 변환합니다.

쿼리:

- `q`: 검색어

응답:

```json
{
  "items": [
    {
      "id": "dest-seoul-station",
      "name": "서울역",
      "address": "서울 중구 한강대로 405",
      "lat": 37.5547,
      "lng": 126.9706,
      "source": "mock"
    }
  ]
}
```

## GET /parking/nearby

목적지 좌표 주변 주차장을 조회합니다.

쿼리:

- `lat`: 목적지 위도
- `lng`: 목적지 경도
- `radiusMeters`: 검색 반경, 기본 800
- `preferPublic`: 공영 선호 여부
- `evOnly`: EV 가능 주차장만
- `accessibleOnly`: 교통약자 접근 가능 주차장만

## GET /parking/providers/health

provider 상태, 마지막 성공 시각, freshness, 오류 메시지를 반환합니다.
## GET /discover/lodging

Returns lodging options near a destination with normalized booking-platform offer candidates.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `DEFAULT_DISCOVER_RADIUS_METERS`
- `checkIn`: optional `YYYY-MM-DD`; reserved for future booking-price providers
- `checkOut`: optional `YYYY-MM-DD`; reserved for future booking-price providers
- `adults`: optional adult count; reserved for future booking-price providers
- `rooms`: optional room count; reserved for future booking-price providers

Response:

```json
{
  "items": [
    {
      "id": "tourapi:12345",
      "name": "City Stay Hotel",
      "lodgingType": "호텔",
      "address": "서울특별시 중구 남대문로 24",
      "lat": 37.5685,
      "lng": 126.979,
      "distanceMeters": 240,
      "rating": null,
      "reviewCount": null,
      "imageUrl": null,
      "source": "tourapi",
      "sourceUrl": null,
      "lowestPriceText": null,
      "lowestPricePlatform": null,
      "offers": [],
      "amenities": ["전화 02-000-0000"]
    }
  ],
  "generatedAt": "2026-04-29T00:00:00.000Z"
}
```
