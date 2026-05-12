# Discover data sources

Last updated: 2026-05-12

## Festivals

Festival discovery uses Korea Tourism Organization TourAPI and national public culture festival data when `FESTIVAL_PROVIDER_ENABLED=true` and `PUBLIC_DATA_SERVICE_KEY` is configured.

- Endpoint adapter: `TourApiFestivalProvider`
- Candidate source: Korea Tourism Organization TourAPI on data.go.kr and the related TourAPI `searchFestival2` operation.
- Why: official/public structured tourism data with event start date, event end date, title, address, image, and coordinates (`mapx`, `mapy`) for many festival records.
- Refresh policy: Cloudflare Worker cron syncs festival data into D1 every hour. User-facing `/discover/festivals` reads D1 only.
- Limitations: coverage and images depend on TourAPI publication quality. Source detail links should be added only after the final official URL pattern is verified.

Additional festival source:

- Endpoint adapter: `NationalCultureFestivalProvider`
- Candidate source: data.go.kr national culture festival standard data.
- Why: nationwide official festival rows with title, period, venue/address, coordinates, organizer/sponsor text, phone, homepage, and reference date.
- Limitations: source quality varies by local government. Some rows have sparse descriptions or outdated reference dates.

## Events

The event layer uses Seoul Open Data plus national culture/event providers when `EVENT_PROVIDER_ENABLED=true`.

- Endpoint adapter: `SeoulCultureEventProvider`
- Candidate source: Seoul Open Data `culturalEventInfo`, served from `http://openapi.seoul.go.kr:8088/{KEY}/json/culturalEventInfo/...`.
- Why: official structured city data for cultural events with title, date, venue, fee text, image/link fields, and coordinate fields.
- Additional adapters: `CulturePortalEventProvider`, `KopisEventProvider`, and `KcisaCultureEventProvider`.
- Additional sources:
  - Culture Portal "한눈에보는문화정보" public culture/performance data, source id `culture_portal`.
  - KOPIS performance list, source id `kopis`.
  - KCISA API id 428, `meta16/getkopis07`, source id `kcisa_428`.
  - KCISA API id 196, `meta4/getKCPG0504`, source id `kcisa_196`.
- Refresh policy: Cloudflare Worker cron syncs festival and event data into D1 every hour. User-facing `/discover/events` reads D1 only.
- Limitations:
  - Some KOPIS/KCISA rows provide venue text rather than coordinates. The backend resolves these with Kakao Local when `KAKAO_REST_API_KEY` is available; unresolved rows are omitted from map pins.
  - Several list APIs provide no rich long-form description. The iOS detail screen displays the upstream description when present and otherwise generates a short structured summary from title, period, venue/address, type, price, and source.
  - Richer descriptions require provider-specific detail endpoint enrichment in a later phase.

## iOS presentation

- The map exposes one toggle named "이벤트" for all event/festival pins.
- The event tab shows one combined list but filters by user-facing category rather than API source.
- The event tab list loads only while the tab is active, unloads after leaving the tab, and renders 20 rows at a time.
- Map event pins and event tab rows route to the same event detail + nearby parking recommendation screen.
- That recommendation screen merges `/parking/nearby` and `/parking/realtime` before ranking so realtime-capable parking is not excluded.

## Required secrets

| Secret | Used by | Notes |
| --- | --- | --- |
| `PUBLIC_DATA_SERVICE_KEY` | TourAPI, national culture festival, optional Culture Portal fallback | Existing data.go.kr key. |
| `SEOUL_OPEN_DATA_KEY` | Seoul cultural events | Existing Seoul Open Data key. |
| `CULTURE_PORTAL_API_KEY` | Culture Portal event provider | Optional if Culture Portal can use public data key fallback. |
| `KOPIS_API_KEY` | KOPIS event provider | Required for KOPIS source. |
| `KCISA_428_API_KEY` | KCISA id 428 provider | Required for `kcisa_428`. |
| `KCISA_196_API_KEY` | KCISA id 196 provider | Required for `kcisa_196`. |
| `KAKAO_REST_API_KEY` | Coordinate resolution for text-only venues | Also used for destination search. |

## Deferred

Restaurant-specific free promotions are intentionally not included in phase 1. There is no stable official structured source in the current design, and scraping-heavy sources are avoided for reliability and terms-of-use safety.
