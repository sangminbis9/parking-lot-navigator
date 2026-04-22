# API Runbook

Last updated: 2026-04-22

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

Realtime clusters:

```bash
curl -sS "https://parking-lot-navigator-api.parkingnav.workers.dev/parking/realtime/clusters?lat=36.35&lng=127.8&radiusMeters=460000&clusterMeters=45000"
```

## D1

- D1 database name: `parking-lot-navigator`
- D1 binding: `DB`
- Worker migration files live in `worker-backend/migrations`.

Important tables:

- `parking_lots`: nationwide/static parking index.
- `realtime_parking_status`: realtime parking cache.

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

## Known Public API Notes

Seoul Open Data:

- Same Seoul Open Data key can access multiple Seoul Open Data services if approved/enabled.
- `GetParkingInfo`: realtime parking counts, no coordinates.
- `GetParkInfo`: parking metadata and coordinates for some rows.
- `TbParkingInfoView`: Hangang parking info, coordinates and capacity, no realtime available-space count.

Public Data Portal:

- Nationwide parking standard data feeds D1 static parking index.
- Some public API calls may intermittently fail with network reset; retry in smaller page ranges.

## Build Notes

- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
- If tools are missing locally, rely on CI/Codemagic for full build/test.
- Always run `git diff --check` before committing when possible.
- Bump iOS build number before committing app-related changes.

