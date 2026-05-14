# Cloudflare Worker Backend

This package runs the Parking Lot Navigator API on Cloudflare Workers.

Last updated: 2026-05-12

## One-time setup

```powershell
pnpm install
pnpm --filter @parking/worker-backend exec wrangler login
```

Create `worker-backend/.dev.vars` from `.dev.vars.example` for local testing. Do not commit real keys.

Set production secrets in Cloudflare:

```powershell
cd worker-backend
pnpm exec wrangler secret put KAKAO_REST_API_KEY
pnpm exec wrangler secret put SEOUL_OPEN_DATA_KEY
pnpm exec wrangler secret put PUBLIC_DATA_SERVICE_KEY
pnpm exec wrangler secret put CULTURE_PORTAL_API_KEY
pnpm exec wrangler secret put KOPIS_API_KEY
pnpm exec wrangler secret put KCISA_428_API_KEY
pnpm exec wrangler secret put KCISA_196_API_KEY
pnpm exec wrangler secret put SYNC_ADMIN_TOKEN
```

`CULTURE_PORTAL_API_KEY` can be omitted when the Culture Portal API is approved for the same data.go.kr key stored in `PUBLIC_DATA_SERVICE_KEY`.

Create the D1 database in Cloudflare Dashboard or with Wrangler, then keep the `DB` binding in `wrangler.toml`.

Apply schema migrations after creating the database:

```powershell
cd worker-backend
pnpm exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0001_parking_lots.sql
pnpm exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0002_realtime_parking_status.sql
pnpm exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0003_discovery_items.sql
pnpm exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0004_local_events.sql
```

Preview one national parking data page without writing to D1:

```powershell
curl -H "Authorization: Bearer <SYNC_ADMIN_TOKEN>" "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/admin/sync-national-parking/preview?pageNo=1&numOfRows=20"
```

Sync one page into D1:

```powershell
curl -X POST -H "Authorization: Bearer <SYNC_ADMIN_TOKEN>" "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/admin/sync-national-parking?pageNo=1&numOfRows=500"
```

If Worker runtime cannot reach `data.go.kr`, run the GitHub Actions workflow instead:

```text
Actions -> Sync national parking D1 -> Run workflow
```

Start with `page_start=1`, `page_end=1`, `num_rows=500`, and `dry_run=true`. If the sample looks right, run again with `dry_run=false`.

Discovery data is synced by Cloudflare Cron and stored in D1:

- Realtime parking: every minute (`* * * * *`)
- Festivals and events: every hour (`0 * * * *`)
- Worker deploys from `master` refresh the discovery cache after deployment when the GitHub `SYNC_ADMIN_TOKEN` secret is configured.

User-facing parking and discovery endpoints read from D1 only. External discovery providers are called only by cron or the admin sync endpoint:

```powershell
curl -X POST -H "Authorization: Bearer <SYNC_ADMIN_TOKEN>" "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/admin/sync-discovery?kinds=festivals,events"
```

Configured discovery providers:

- Festivals: TourAPI and national culture festival standard data through `PUBLIC_DATA_SERVICE_KEY`.
- Events: Seoul Open Data through `SEOUL_OPEN_DATA_KEY`.
- Events: Culture Portal through `CULTURE_PORTAL_API_KEY` or `PUBLIC_DATA_SERVICE_KEY`.
- Events: KOPIS through `KOPIS_API_KEY`.
- Events: KCISA id 428 through `KCISA_428_API_KEY`.
- Events: KCISA id 196 through `KCISA_196_API_KEY`.
- Text-only event locations can be geocoded through Kakao Local when `KAKAO_REST_API_KEY` is configured.

iOS client behavior to keep in mind:

- The map displays all discovery providers through one "이벤트" toggle.
- The event tab loads discovery data on demand and pages rows in batches of 20.
- Event detail recommendations call both `/parking/nearby` and `/parking/realtime` and merge results before ranking.

You can also trigger the same refresh from GitHub Actions:

```text
Actions -> Sync discovery D1 -> Run workflow
```

## Local development

```powershell
pnpm worker:dev
```

Check:

```powershell
curl http://localhost:8787/health
curl "http://localhost:8787/search/destination?q=서울역"
```

## Deploy

```powershell
pnpm worker:deploy
```

After deployment, test:

```powershell
curl https://parking-lot-navigator-api.<your-subdomain>.workers.dev/health
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/discover/providers/health"
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/api/festivals?lat=37.5665&lng=126.9780&radiusMeters=60000&upcomingWithinDays=30"
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/api/local-events?lat=37.5665&lng=126.9780&radiusMeters=20000&limit=50"
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/api/map/items?type=all&lat=37.5665&lng=126.9780&radiusMeters=60000"
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/discover/clusters?lat=36.35&lng=127.80&radiusMeters=460000&clusterMeters=25000"
```
