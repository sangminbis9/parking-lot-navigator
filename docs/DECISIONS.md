# Decisions

Last updated: 2026-05-26

## Product Direction

- Shift the main app experience from realtime parking to local festival/event discovery.
- Keep parking recommendations as a practical support flow after the user chooses a destination, event, or festival.
- Preserve the existing parking flow as a secondary path: destination search -> nearby parking recommendations.
- Continue expanding from Seoul-centered parking recommendations to nationwide parking recommendations.
- Build the app as a destination companion: choose an event/festival/place, then compare nearby parking without leaving the map context.
- Keep realtime parking as a map toggle, off by default.
- Use Cloudflare Worker as production backend.
- Use Cloudflare D1 for normalized parking data and realtime cache.
- Keep map discovery controls simple: one user-facing toggle named "이벤트" for all event/festival providers.
- Keep provider/source distinctions in data and filters, not as separate map toggles.

## Brand/UI Direction

- Use the ticket-shaped festival mascot as the recognizable app character.
- Prefer mascot-led empty states, guide/tip surfaces, detail placeholders, and friendly discovery moments.
- The mascot can change pose/form by context, but should remain clearly the same character.
- Figma is the design reference source, but implementation should keep SwiftUI structure maintainable and app-native.
- The visual tone should feel like a festival/event guide rather than a parking utility.

## Data Strategy

- Avoid calling large public APIs directly for every app request.
- Store nationwide static parking data in D1.
- Use D1 for fast nearby search.
- Merge regional realtime providers on top of static/provider candidates.
- Use Kakao Local `category_group_code=PK6` as a fallback for broad candidate coverage.
- Expand event/festival discovery nationally through official APIs before scraping.
- Current discovery sources include TourAPI, national culture festival standard data, Seoul Open Data, Culture Portal, KOPIS, KCISA id 428, and KCISA id 196.
- Rows without usable coordinates can be geocoded by Kakao Local during sync where configured; unresolved rows are omitted from map pin display.
- Several official list APIs have sparse descriptions. Prefer showing upstream descriptions when present and a generated structured summary when absent; add detail API enrichment later.

## Realtime Strategy

- Use D1 realtime cache for map-wide realtime display.
- Sync cadence target: about 5 minutes.
- Realtime toggle should show nationwide data, not only the current viewport.
- Realtime parking pins render from the loaded realtime lot list instead of numeric server/app clusters.
- Realtime parking pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.
- Event detail parking recommendations should merge normal nearby parking and realtime parking before ranking.
- If realtime parking fails, nearby parking recommendations should continue to render.

## Seoul Realtime Details

- `GetParkingInfo` has realtime counts but no coordinates.
- `GetParkInfo` has metadata and some coordinates.
- Seoul realtime provider merges `GetParkingInfo` and `GetParkInfo` by `PKLT_CD`.
- For remaining Seoul realtime rows without coordinates, Kakao address search may be used in large-radius realtime sync contexts.
- Hangang `TbParkingInfoView` has coordinates and capacity, but does not provide realtime available spaces.

## Calendar & Widget Decisions

- 캘린더는 메인 탭 바의 **새 탭**으로 추가. 탭 순서는 `지도 → 이벤트 → 즐겨찾기 → 캘린더 → 사무실 → 설정`.
- 위젯은 **Medium 사이즈만** 지원 (다가오는 축제 3개 카드). Small/Large 는 v1.1 이후 후보.
- 위젯은 네트워크를 직접 호출하지 않고, 앱이 App Group container 에 저장한 JSON 캐시(`widget_festivals.json`)만 읽는다. 앱은 cold start / foreground / 필터 변경 시 `FestivalSyncService` 로 캐시를 갱신하고 `WidgetCenter.shared.reloadTimelines` 를 호출한다.
- 공유 필터 축은 4종: 지역(시·도), 거리 반경(10/20/50km/무제한), 태그/장르, 진행 상태(진행중/예정). App Group `UserDefaults` 로 저장되어 메인 앱과 위젯이 동일 필터를 본다.
- EventKit 연동(iOS 기본 캘린더 추가 버튼)은 v1 에서 제외하고 v1.1 로 deferred. NSCalendarsUsageDescription, PrivacyInfo 갱신을 함께 다룰 때 도입.
- 위젯 extension Bundle ID 는 `$(APP_BUNDLE_ID).UpcomingFestivalsWidget` 으로 project.yml inline 파생. Codemagic xcconfig 에 별도 변수를 추가하지 않는다 (변수 누락으로 ValidateEmbeddedBinary 가 실패한 사고를 회피).

## iOS Map Layer Decisions

- Realtime parking toggle label should be simple and not duplicate the parking symbol.
- Festival/event providers are displayed through one map toggle named "이벤트".
- Festival/event layers do not use numeric clustering. They render actual pins.
- Festival/event pins hide title labels until deep zoom.
- Festival/event pins that overlap in screen space collapse to one representative pin while zoomed out, then separate with small offsets after zooming in.
- The map bottom panel uses tabs for parking recommendations and a unified discovery list.
- The discovery list uses already-loaded local data for search and sorting; default sort is distance, with date and name options.
- Discovery list distance sorting/display uses the user's current location when available, falling back to provider distance only before location is known.
- Map pin taps and event tab row taps should open the same event detail + nearby parking recommendation screen.
- The event tab should load discovery data only when selected, unload after leaving, and render rows in pages of 20 to avoid SwiftUI list/diff stalls.

## Build/Release

- When committing changes, bump iOS build number by one.
- Before TestFlight upload, confirm Codemagic's publish log shows a `Version code` higher than the previous App Store Connect build.
- A publish attempt on 2026-05-09 failed because the uploaded IPA still had build number 79 while App Store Connect already had build 79.
- A later publish attempt failed because the uploaded IPA still had build number 95 while App Store Connect already had build 95.
- Current build metadata target is `1.0 (134)` (Codemagic 빌드 성공 시점 기준).
- Codemagic/TestFlight is used for iOS build validation. Codemagic 코드 사이닝은 **수동(Manual)** 방식이며, 새 app extension target 추가 시 별도 distribution provisioning profile 을 발급해 업로드해야 한다.
- 신규 app extension 추가 시 체크리스트: ① Apple Developer Portal 에서 App ID 등록 ② App Groups capability 의 **Configure 버튼**으로 기존 그룹에 명시 매핑 (체크박스만 켜는 것은 부족) ③ 동일 distribution certificate 로 provisioning profile 발급 후 Codemagic Provisioning profiles 슬롯에 업로드 ④ project.yml 에서 Bundle ID 를 `$(APP_BUNDLE_ID).XXX` 형태로 inline 파생.
- GitHub Actions also runs an iOS simulator validation workflow on pushes and pull requests.
- Backend tests run in CI/Codemagic.
- Local Windows environment may not have `node`, `npm`, `swift`, or `xcodebuild`.
