# Backend API

Last updated: 2026-05-12

## GET /search/destination

Returns destination candidates for a search query.

Query:

- `q`: search keyword

## GET /parking/nearby

Returns parking lots near a destination coordinate.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `800`
- `preferPublic`: prefer public parking lots
- `evOnly`: only EV-capable parking lots
- `accessibleOnly`: only accessible parking lots

## GET /parking/realtime

Returns realtime-capable parking lots near a coordinate.

## GET /parking/providers/health

Returns provider health, last successful sync time, freshness, and error messages.

## GET /api/festivals

Preferred festival endpoint. Returns public/API-backed festival and cultural discovery records. Data previously exposed as public "events" is now treated as festival discovery data so it cannot be confused with local store events.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `DEFAULT_DISCOVER_RADIUS_METERS`
- `ongoingOnly`: optional boolean filter
- `upcomingWithinDays`: optional day window, default `30`

## GET /discover/festivals

Backward-compatible festival endpoint. New clients should use `/api/festivals`.

## GET /discover/events

Deprecated. Use `/api/festivals` for public/API-backed festival data or `/api/local-events` for restaurant, cafe, shop, popup, review, freebie, and discount events.

## GET /api/local-events

Returns approved local store events.

Query:

- `lat`: destination latitude
- `lng`: destination longitude
- `radiusMeters`: search radius, default `DEFAULT_DISCOVER_RADIUS_METERS`
- `cursor`: optional pagination cursor
- `limit`: page size, max `100`

## GET /api/local-events/:id

Returns one approved local event.

## POST /api/local-events/report

Creates a pending user report. The server may structure a provided source URL/caption/store/address into a draft, but does not scrape Instagram HTML, spoof login sessions, call unofficial APIs, bypass bot detection, or store commenter/user personal data.

## POST /api/admin/local-events

Creates an owner/admin-entered local event. Admin-created items can be `pending`, `approved`, `rejected`, or `expired`.

## PATCH /api/admin/local-events/:id/status

Updates review state for a local event.

## PATCH /api/admin/local-events/:id

Updates local event content and monetization fields such as `isSponsored`, `sponsorTier`, `paidUntil`, and `priorityScore`.

## GET /api/map/items

Returns map items with explicit marker types.

Query:

- `type`: `festival`, `event`, or `all`
- `lat`, `lng`, `radiusMeters`
- `cursor`, `limit` for local event paging

Marker types:

- `festival`: public/API-backed festival or public cultural discovery data
- `local_event`: local store event

## GET /discover/clusters

Returns map clusters for cached festival records. Local event map results use `/api/map/items` so approval and sponsored priority can be applied directly.

## Client Behavior

- The festival filter loads `/api/festivals`.
- The event filter loads `/api/local-events`.
- The list renders 20 rows initially and loads 20 more as the user scrolls.
- Map pins and list rows both navigate to the same detail + parking recommendation screen.
- Local event cards show event title, store name, benefit, distance, end date, source badge, and sponsored badge when present.
