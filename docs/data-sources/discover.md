# Discover data sources

## Festivals

Phase 1 uses Korea Tourism Organization TourAPI through data.go.kr when `FESTIVAL_PROVIDER_ENABLED=true` and `PUBLIC_DATA_SERVICE_KEY` is configured.

- Endpoint adapter: `TourApiFestivalProvider`
- Candidate source: Korea Tourism Organization TourAPI on data.go.kr and the related TourAPI `searchFestival2` operation.
- Why: official/public structured tourism data with event start date, event end date, title, address, image, and coordinates (`mapx`, `mapy`) for many festival records.
- Refresh policy: server response cache via `DISCOVER_CACHE_TTL_SECONDS`; default is 6 hours because festival data does not need second-level freshness.
- Limitations: coverage and images depend on TourAPI publication quality. Source detail links should be added only after the final official URL pattern is verified.

## Free events

Phase 1 uses Seoul Open Data cultural event information when `EVENT_PROVIDER_ENABLED=true` and `SEOUL_OPEN_DATA_KEY` is configured.

- Endpoint adapter: `SeoulCultureEventProvider`
- Candidate source: Seoul Open Data `culturalEventInfo`, served from `http://openapi.seoul.go.kr:8088/{KEY}/json/culturalEventInfo/...`.
- Why: official structured city data for cultural events with title, date, venue, fee text, image/link fields, and coordinate fields.
- Default: feature flag is off in production examples until the data quality is checked with real keys.
- Limitations: strongest coverage is Seoul. Free status is inferred from official fee text, so ambiguous rows are excluded when `freeOnly=true`.

## Lodging

Phase 1 uses domestic lodging discovery APIs when `LODGING_PROVIDER_ENABLED=true`.

- Primary adapter: `TourApiLodgingProvider`, using Korea Tourism Organization TourAPI `locationBasedList2` with lodging `contentTypeId=32`.
- Fallback adapter: `KakaoLodgingProvider`, using Kakao Local category search with accommodation category `AD5`.
- Why: both sources can show real nearby lodging names, addresses, coordinates, and basic contact/source metadata without OTA approval.
- Refresh policy: server response cache via `DISCOVER_CACHE_TTL_SECONDS`; default is 6 hours because lodging location metadata is not second-level data.
- Map behavior: iOS sends the current map viewport radius for lodging, festivals, and events. Lodging searches larger than one provider radius are split into cached 20 km tiles server-side.
- Limitations: public domestic APIs do not provide live booking availability, room inventory, or cross-platform lowest prices. Expedia/Booking-style offers remain a future provider path if an OTA API is approved.

## Deferred

Restaurant-specific free promotions are intentionally not included in phase 1. There is no stable official structured source in the current design, and scraping-heavy sources are avoided for reliability and terms-of-use safety.
