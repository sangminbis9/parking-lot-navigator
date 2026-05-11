# Discover data sources

## Festivals

Phase 1 uses Korea Tourism Organization TourAPI through data.go.kr when `FESTIVAL_PROVIDER_ENABLED=true` and `PUBLIC_DATA_SERVICE_KEY` is configured.

- Endpoint adapter: `TourApiFestivalProvider`
- Candidate source: Korea Tourism Organization TourAPI on data.go.kr and the related TourAPI `searchFestival2` operation.
- Why: official/public structured tourism data with event start date, event end date, title, address, image, and coordinates (`mapx`, `mapy`) for many festival records.
- Refresh policy: Cloudflare Worker cron syncs festival data into D1 every hour. User-facing `/discover/festivals` reads D1 only.
- Limitations: coverage and images depend on TourAPI publication quality. Source detail links should be added only after the final official URL pattern is verified.

## Events

The event layer uses Seoul Open Data plus national culture/event providers when `EVENT_PROVIDER_ENABLED=true`.

- Endpoint adapter: `SeoulCultureEventProvider`
- Candidate source: Seoul Open Data `culturalEventInfo`, served from `http://openapi.seoul.go.kr:8088/{KEY}/json/culturalEventInfo/...`.
- Why: official structured city data for cultural events with title, date, venue, fee text, image/link fields, and coordinate fields.
- Additional adapters: `CulturePortalEventProvider`, `KopisEventProvider`, and `KcisaCultureEventProvider`.
- Additional sources: Culture Portal public performance displays, KOPIS performance list, KCISA API id 428 (`meta16/getkopis07`), and KCISA API id 196 (`meta4/getKCPG0504`).
- Refresh policy: Cloudflare Worker cron syncs festival and event data into D1 every hour. User-facing `/discover/events` reads D1 only.
- Limitations: some KOPIS/KCISA rows provide venue text rather than coordinates. The backend resolves these with Kakao Local when `KAKAO_REST_API_KEY` is available; unresolved rows are omitted from map pins.

## Deferred

Restaurant-specific free promotions are intentionally not included in phase 1. There is no stable official structured source in the current design, and scraping-heavy sources are avoided for reliability and terms-of-use safety.
