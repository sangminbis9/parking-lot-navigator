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
  IOS -- "알림 설정 / 마지막 위치 저장" --> SharedStore

  BGTask["BGAppRefreshTask (DiscoveryNotificationService)"] --> API
  SharedStore --> BGTask
  BGTask --> LocalNotif["로컬 알림 (UNUserNotificationCenter)"]
  LocalNotif --> User

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
- Main app: 알림 설정(`notificationPreferences`)과 마지막 알려진 좌표(`lastKnownLocation.*`)를 저장한다. `DiscoveryNotificationService` 가 `BGAppRefreshTask` 로 깨어나 이 값을 읽어 관심 조건(카테고리/지역/반경)에 맞는 새 축제·로컬 이벤트를 Worker API 에서 조회하고, 신규 항목이 있으면 `UNUserNotificationCenter` 로 도메인별 요약 로컬 알림을 보낸다. 서버 푸시(APNs)는 사용하지 않는다 (best-effort, iOS 가 실행 시점 결정).
