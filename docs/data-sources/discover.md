# Discover data sources

## Festivals

Phase 1 uses Korea Tourism Organization TourAPI through data.go.kr when `FESTIVAL_PROVIDER_ENABLED=true` and `PUBLIC_DATA_SERVICE_KEY` is configured.

- Endpoint adapter: `TourApiFestivalProvider`
- Candidate source: Korea Tourism Organization TourAPI on data.go.kr and the related TourAPI `searchFestival2` operation.
- Why: official/public structured tourism data with event start date, event end date, title, address, image, and coordinates (`mapx`, `mapy`) for many festival records.
- Refresh policy: Cloudflare Worker cron syncs festival data into D1 every hour. User-facing `/discover/festivals` reads D1 only.
- Limitations: coverage and images depend on TourAPI publication quality. Source detail links should be added only after the final official URL pattern is verified.

## Free events

Phase 1 uses Seoul Open Data cultural event information when `EVENT_PROVIDER_ENABLED=true` and `SEOUL_OPEN_DATA_KEY` is configured.

- Endpoint adapter: `SeoulCultureEventProvider`
- Candidate source: Seoul Open Data `culturalEventInfo`, served from `http://openapi.seoul.go.kr:8088/{KEY}/json/culturalEventInfo/...`.
- Why: official structured city data for cultural events with title, date, venue, fee text, image/link fields, and coordinate fields.
- Refresh policy: Cloudflare Worker cron syncs event data into D1 every hour. User-facing `/discover/events` reads D1 only.
- Limitations: strongest coverage is Seoul. Free status is inferred from official fee text, so ambiguous rows are excluded when `freeOnly=true`.

## Lodging

Phase 1 uses domestic lodging discovery APIs when `LODGING_PROVIDER_ENABLED=true`.

- Primary adapter: `TourApiLodgingProvider`, using Korea Tourism Organization TourAPI `locationBasedList2` with lodging `contentTypeId=32`.
- Fallback adapter: `KakaoLodgingProvider`, using Kakao Local category search with accommodation category `AD5`.
- Why: both sources can show real nearby lodging names, addresses, coordinates, and basic contact/source metadata without OTA approval.
- Refresh policy: Cloudflare Worker cron syncs lodging into D1 once per day at 03:00 KST (`0 18 * * *` UTC). User-facing `/discover/lodging` reads D1 only.
- Map behavior: iOS sends the current map viewport radius for festivals and events. Lodging uses the same discovery list/pin format but keeps a broader minimum search radius so it does not feel limited to the visible map slice. Large-map views should use DB-backed limits or `/discover/clusters` rather than rendering every national record as an individual pin.
- Limitations: public domestic APIs do not provide live booking availability, room inventory, or cross-platform lowest prices. Expedia/Booking-style offers remain a future provider path if an OTA API is approved.

## Deferred

Restaurant-specific free promotions are intentionally not included in phase 1. There is no stable official structured source in the current design, and scraping-heavy sources are avoided for reliability and terms-of-use safety.
