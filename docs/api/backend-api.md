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

Returns free event records from the D1 discovery cache.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `DEFAULT_DISCOVER_RADIUS_METERS`
- `ongoingOnly`: optional boolean filter
- `upcomingWithinDays`: optional day window, default `30`
- `freeOnly`: optional boolean filter, default `true`

## GET /discover/clusters

Returns map clusters for cached festival and event records.
