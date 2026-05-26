# Signing Placeholder 문서

실제 signing 값은 저장소에 커밋하지 않습니다.

필요 항목:

- Apple Developer Team ID
- 앱 Bundle ID: `com.example.ParkingLotNavigator`
- App Intents extension Bundle ID (현재는 메인 앱 target 에 포함)
- Share Extension Bundle ID: `com.example.ParkingLotNavigator.ShareExtension`
- Widget Extension Bundle ID: `com.example.ParkingLotNavigator.UpcomingFestivalsWidget` (project.yml 에서 `$(APP_BUNDLE_ID).UpcomingFestivalsWidget` 으로 inline 파생)
- App Group ID: `group.com.example.ParkingLotNavigator` (세 App ID 모두에 Configure 로 명시 매핑)
- Debug/Release provisioning profile (메인 / Share / Widget 각각)
- Push, Associated Domains 사용 여부

`ios-app/project.yml`의 placeholder 값을 실제 값으로 교체한 뒤 XcodeGen을 다시 실행하세요.
