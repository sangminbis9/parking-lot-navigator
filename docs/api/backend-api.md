# Backend API

## GET /search/destination

Returns destination candidates for a search query.

Query:

- `q`: search keyword

Response:

```json
{
  "items": [
    {
      "id": "dest-seoul-station",
      "name": "Seoul Station",
      "address": "405 Hangang-daero, Jung-gu, Seoul",
      "lat": 37.5547,
      "lng": 126.9706,
      "source": "mock"
    }
  ]
}
```

## GET /parking/nearby

Returns parking lots near a destination coordinate.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `800`
- `preferPublic`: prefer public parking lots
- `evOnly`: only EV-capable parking lots
- `accessibleOnly`: only accessible parking lots

## GET /parking/providers/health

Returns provider health, last successful sync time, freshness, and error messages.

## GET /discover/festivals

Returns festival records from the D1 discovery cache.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `DEFAULT_DISCOVER_RADIUS_METERS`
- `ongoingOnly`: optional boolean filter
- `upcomingWithinDays`: optional day window, default `30`

## GET /discover/events

Returns event records from the D1 discovery cache. The map UI exposes these through one "이벤트" layer together with festival records.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `DEFAULT_DISCOVER_RADIUS_METERS`
- `ongoingOnly`: optional boolean filter
- `upcomingWithinDays`: optional day window, default `30`
- `freeOnly`: optional boolean filter, default `false`

Configured event providers:

| Environment variable | Provider | Source id |
| --- | --- | --- |
| `SEOUL_OPEN_DATA_KEY` | Seoul Open Data cultural events | `seoul_open_data` |
| `CULTURE_PORTAL_API_KEY` or `PUBLIC_DATA_SERVICE_KEY` | Culture Portal public performance displays | `culture_portal` |
| `KOPIS_API_KEY` | KOPIS performance list | `kopis` |
| `KCISA_428_API_KEY` | KCISA API id 428, `meta16/getkopis07` | `kcisa_428` |
| `KCISA_196_API_KEY` | KCISA API id 196, `meta4/getKCPG0504` | `kcisa_196` |

## GET /discover/clusters

Returns map clusters for cached festival and event records.
