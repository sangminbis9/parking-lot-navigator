# 전체 시스템 아키텍처

```mermaid
flowchart TD
  User["운전자"] --> IOS["iOS SwiftUI 앱"]
  Siri["Siri / Spotlight / Shortcuts"] --> Intents["App Intents"]
  Share["Share Extension"] --> SharedStore["App Group 공유 저장소"]
  Widget["UpcomingFestivalsWidget (Medium)"] --> SharedStore
  DeepLink["Deep Link"] --> IOS

  Intents --> DeepLink
  SharedStore --> IOS
  IOS -- "FestivalSyncService 캐시 갱신" --> SharedStore

  IOS --> API["Backend Fastify / Cloudflare Worker API"]
  IOS --> NavService["NavigationService protocol"]
  NavService --> MockNav["MockNavigationService"]
  NavService --> KakaoBridge["KakaoNavigationBridge Objective-C wrapper"]
  KakaoBridge --> KakaoNav["Kakao Mobility iOS UI SDK"]

  API --> KakaoLocal["Kakao Local API"]
  API --> Composite["CompositeParkingProvider"]
  Composite --> SeoulRT["SeoulRealtimeParkingProvider"]
  Composite --> SeoulMeta["SeoulParkingMetadataProvider"]
  Composite --> TS["TSKoreaParkingProvider"]
  Composite --> Mock["MockParkingProvider"]

  Composite --> Normalize["Normalization"]
  Normalize --> Dedup["Deduplication"]
  Dedup --> Rank["Ranking Engine"]
  Rank --> Cache["In-memory Cache"]
  Cache --> API

  API --> Health["Provider Health / Freshness Logs"]
```

`App Group 공유 저장소` (`group.com.sangminbis9.ParkingLotNavigator`) 는 세 iOS target 이 공유한다:

- Main app: `FestivalSyncService` 가 `/api/festivals?upcomingWithinDays=90` 결과를 필터 적용 후 `widget_festivals.json` 으로 저장하고 `WidgetCenter.shared.reloadTimelines` 호출.
- ShareExtension: 공유받은 주소/URL 을 임시 목적지 후보로 저장.
- UpcomingFestivalsWidget: `widget_festivals.json` 캐시만 읽고 timeline 갱신 (네트워크 직접 호출 없음).
