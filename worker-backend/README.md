# Cloudflare Worker Backend

This package runs the Parking Lot Navigator API on Cloudflare Workers.

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
pnpm exec wrangler secret put SYNC_ADMIN_TOKEN
```

Create the D1 database in Cloudflare Dashboard or with Wrangler, then keep the `DB` binding in `wrangler.toml`.

Apply schema migrations after creating the database:

```powershell
cd worker-backend
pnpm exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0001_parking_lots.sql
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
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/discover/festivals?lat=37.5665&lng=126.9780&radiusMeters=60000&upcomingWithinDays=30"
```
