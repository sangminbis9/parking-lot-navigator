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
```

Create the D1 database in Cloudflare Dashboard or with Wrangler, then keep the `DB` binding in `wrangler.toml`.

Apply schema migrations after creating the database:

```powershell
cd worker-backend
pnpm exec wrangler d1 execute parking-lot-navigator --remote --file ./migrations/0001_parking_lots.sql
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
curl "https://parking-lot-navigator-api.<your-subdomain>.workers.dev/discover/festivals?lat=37.5665&lng=126.9780&radiusMeters=60000&upcomingWithinDays=30"
```
