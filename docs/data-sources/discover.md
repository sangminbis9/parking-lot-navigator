# Discover Data Sources

Last updated: 2026-05-12

## Festivals

Festival discovery uses Korea Tourism Organization TourAPI and national public culture festival data when `FESTIVAL_PROVIDER_ENABLED=true` and `PUBLIC_DATA_SERVICE_KEY` is configured.

- `TourApiFestivalProvider`: Korea Tourism Organization TourAPI `searchFestival2`.
- `NationalCultureFestivalProvider`: data.go.kr national culture festival standard data.
- Refresh policy: Cloudflare Worker cron syncs festival data into D1 every hour. User-facing festival endpoints read D1.
- User-facing endpoints: `/api/festivals`, with `/discover/festivals` kept for compatibility.

## Public Cultural Data Formerly Named Events

The old public "event" providers are no longer the app's event domain. They are folded into festival discovery because they are public/API-backed cultural listings, not restaurant, cafe, shop, popup, review, discount, or freebie events.

Legacy adapters:

- `SeoulCultureEventProvider`: Seoul Open Data cultural events.
- `CulturePortalEventProvider`: Culture Portal public performance/display data.
- `KopisEventProvider`: KOPIS performance list.
- `KcisaCultureEventProvider`: KCISA public culture/performance APIs.

Worker sync stores these rows with discovery type `festival`, and migration `0004_local_events.sql` converts cached `discovery_items.type = 'event'` rows to `festival`.

## Local Store Events

Local store events are stored separately in `local_events` and exposed through `/api/local-events`.

Allowed sources:

- `owner_submitted`: store owner submits title, benefit, period, address, images, and Instagram/source links.
- `admin_manual`: operator enters an Instagram post URL or store details and reviews the structured draft.
- `user_report`: app user reports a link, caption, photo reference, or store details. Reports start as `pending`.
- `instagram`: reserved for official Instagram Graph API flows only, such as Hashtag Search or Business Discovery when App Review and permissions allow it.
- `official_site`: store homepage, public official pages, or other compliant public sources, subject to robots.txt, terms, and request limits.
- `other`: compliant aggregator-assisted discovery such as official Naver Search API candidate results. These are used as candidates only and are coordinate-verified with Kakao Local before approval.

Automatic candidate discovery:

- `syncLocalEventDiscovery` first collects restaurant and cafe candidates from Kakao Local category search (`FD6`, `CE7`) around configured region centers.
- For each Kakao place, it checks recent Naver Blog search results for `"place name" event` with `X-Naver-Client-Id` and `X-Naver-Client-Secret`.
- The worker stores only search-result title, summary, source URL, Kakao place fields, and structured event fields. It does not fetch or scrape the target page body.
- Kakao Local category search provides the candidate store identity and coordinates.
- Candidates with verified coordinates and a clear event benefit can be auto-approved when `confidenceScore >= LOCAL_EVENT_AUTO_APPROVE_MIN_SCORE`.
- If a candidate is approved without a clear end date, `endDate` remains `null` and `needsReview=true`.
- Lower-confidence candidates are saved as `pending` and stay hidden until admin approval.
- `LOCAL_EVENT_SEARCH_MAX_QUERIES` limits the number of Kakao places processed per run.

Prohibited collection patterns:

- No unauthorized Instagram HTML crawling.
- No login session spoofing.
- No bot detection bypass.
- No unofficial Instagram API calls.
- No storage of commenter/user personal data.
- Do not copy and store original Instagram post images unless rights and platform policy permit it. Prefer source links or owner-uploaded assets.

Review states:

- `pending`: submitted or auto-structured, not visible in the app.
- `approved`: visible in map/list/detail.
- `rejected`: hidden and retained for moderation history.
- `expired`: hidden from normal event results.

Supported event types:

- `discount`
- `freebie`
- `review_event`
- `popup`
- `limited_menu`
- `opening_event`
- `etc`

Structuring behavior:

- Input can include Instagram post URL, caption text, image alt/caption text, store name, and address candidate.
- Output includes title, description, benefit, start/end dates, store name, address, coordinates, source URL, confidence score, and `needsReview`.
- If the date is unclear, the system does not invent `endDate`; it marks `needsReview=true`.
- Relative text such as "today only", "this week", or "May limited" is interpreted against the current date only when confidence is high.
- If only an Instagram URL exists, the item remains `pending` until an admin verifies the store and location.

## Monetization

The schema includes `isSponsored`, `sponsorTier`, `paidUntil`, and `priorityScore`.

Planned paid products:

- Free event: normal listing.
- Paid event: higher list order, emphasized map pin, and recommendation placement.
- Owner dashboard metrics: impressions, source-link clicks, navigation clicks, and saves.
- Payment providers can be added later through Stripe or Toss Payments without changing core event identity.

## iOS Presentation

- Map filters are separate: parking, festival, and event.
- Festival pins use public/API-backed festival discovery data.
- Event pins use approved local store events only.
- Event cards show title, store name, benefit summary, distance, end date, source badge, and sponsored badge when present.
- Event detail screens include an original source link button when `sourceUrl` is available.
