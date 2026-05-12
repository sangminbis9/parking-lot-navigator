# API Runbook

Last updated: 2026-05-12

## Production API

- Worker URL: `https://parking-lot-navigator-api.parkingnav.workers.dev`
- Health: `GET /health`
- Provider health: `GET /parking/providers/health`

## Common Checks

Health:

```bash
curl -sS https://parking-lot-navigator-api.parkingnav.workers.dev/health
```

Provider health:

```bash
curl -sS https://parking-lot-navigator-api.parkingnav.workers.dev/parking/providers/health
```

Nearby parking:

```bash
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/parking/nearby?lat=37.5665&lng=126.9780&radiusMeters=800"
```

Nationwide realtime:

```bash
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/parking/realtime?lat=36.35&lng=127.8&radiusMeters=460000"
```

Event-detail parking check:

```bash
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/parking/nearby?lat=37.5665&lng=126.9780&radiusMeters=800"
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/parking/realtime?lat=37.5665&lng=126.9780&radiusMeters=800"
```

The iOS event detail screen merges both responses before ranking. If realtime fails but nearby succeeds, recommendations should still render.

Realtime clusters:

```bash
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/parking/realtime/clusters?lat=36.35&lng=127.8&radiusMeters=460000&clusterMeters=45000"
```

Discovery events:

```bash
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/discover/festivals?lat=36.35&lng=127.8&radiusMeters=460000&upcomingWithinDays=365"
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/discover/events?lat=36.35&lng=127.8&radiusMeters=460000&upcomingWithinDays=365"
```

Expected event source IDs after sync, depending on configured secrets:

- `seoul_open_data`
- `culture_portal`
- `kopis`
- `kcisa_428`
- `kcisa_196`

## D1

- D1 database name: `parking-lot-navigator`
- D1 binding: `DB`
- Worker migration files live in `worker-backend/migrations`.

Important tables:

- `parking_lots`: nationwide/static parking index.
- `realtime_parking_status`: realtime parking cache.
- `discovery_items`: cached festivals and events shown on the map.

## Sync

National static sync:

- Script: `worker-backend/scripts/sync-national-parking.mjs`
- GitHub Actions uses secrets for Cloudflare and public data keys.
- Use page ranges gradually to avoid public API instability.

Realtime cache sync:

- Worker cron runs every 5 minutes.
- Manual endpoint: `POST /admin/sync-realtime-parking`
- Requires `Authorization: Bearer <SYNC_ADMIN_TOKEN>`.
- Do not paste or store the real token in docs.

Discovery cache sync:

- Worker cron runs every hour.
- Worker deploys from `master` run a post-deploy discovery refresh when GitHub secret `SYNC_ADMIN_TOKEN` is configured.
- Manual GitHub Action: `Sync discovery D1`.
- Manual endpoint: `POST /admin/sync-discovery?kinds=festivals,events`
- The iOS app reads `/discover/festivals` and `/discover/events` from D1, so newly added discovery providers will not appear in map pins until this sync has run at least once after deployment.
- The event tab also reads these endpoints on demand when the tab is selected.
- Map pins and event tab rows use the same event detail route in iOS.
- If KCISA or KOPIS rows have no coordinates, the backend can resolve a limited number of rows through Kakao Local when `KAKAO_REST_API_KEY` is configured. Rows still missing valid coordinates are omitted from map pin responses.

## Known Public API Notes

Seoul Open Data:

- Same Seoul Open Data key can access multiple Seoul Open Data services if approved/enabled.
- `GetParkingInfo`: realtime parking counts, no coordinates.
- `GetParkInfo`: parking metadata and coordinates for some rows.
- `TbParkingInfoView`: Hangang parking info, coordinates and capacity, no realtime available-space count.

Public Data Portal:

- Nationwide parking standard data feeds D1 static parking index.
- TourAPI and national culture festival standard data feed festival discovery.
- Some public API calls may intermittently fail with network reset; retry in smaller page ranges.

Culture and event APIs:

- `CULTURE_PORTAL_API_KEY` maps to Culture Portal event data. Where applicable, `PUBLIC_DATA_SERVICE_KEY` can be used as fallback.
- `KOPIS_API_KEY` maps to KOPIS performance data.
- `KCISA_428_API_KEY` maps to KCISA API id 428.
- `KCISA_196_API_KEY` maps to KCISA API id 196.
- Several list APIs do not include rich descriptions. The app shows upstream description when present and falls back to a generated summary.

## Build Notes

- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
- If tools are missing locally, rely on CI/Codemagic for full build/test.
- Always run `git diff --check` before committing when possible.
- Bump iOS build number before release/publish commits. Current known target after the latest App Store Connect duplicate-version issue is `1.0 (105)` or higher.
