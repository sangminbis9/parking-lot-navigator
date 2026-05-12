# Backend API

Last updated: 2026-05-12

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

Notes:

- Event detail recommendation screens call this endpoint and merge the result with `/parking/realtime` before ranking.
- If realtime parking fails, the app can still rank the `/parking/nearby` result.

## GET /parking/realtime

Returns realtime-capable parking lots near a coordinate.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius

Notes:

- The map realtime layer can request a broad national radius.
- Event detail recommendation screens request this endpoint around the selected event coordinate and merge it with `/parking/nearby`.
- Duplicate parking lots are deduped on the iOS side for the event recommendation screen, preferring realtime/fresher rows.

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

Client behavior:

- The event tab loads `/discover/festivals` and `/discover/events` only while selected.
- The list renders 20 rows initially and loads 20 more as the user scrolls.
- Map pins and event tab rows both navigate to the same event detail + parking recommendation screen.
- If an event has no upstream description, the iOS client displays a generated summary from available structured fields.

## GET /discover/clusters

Returns map clusters for cached festival and event records.

Current iOS note:

- The iOS map no longer relies on numeric discovery clusters for event pins. It renders pins with overlap handling in the Kakao map layer.
