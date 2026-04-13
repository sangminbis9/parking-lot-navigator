import AppIntents

struct ParkingAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FindParkingNearDestinationIntent(),
            phrases: [
                "\(.applicationName)에서 목적지 주변 주차 찾아줘",
                "\(.applicationName)로 주차장 찾아줘"
            ],
            shortTitle: "주차 찾기",
            systemImageName: "parkingsign"
        )

        AppShortcut(
            intent: NavigateRecentDestinationIntent(),
            phrases: [
                "\(.applicationName)에서 최근 목적지로 길안내",
                "\(.applicationName)로 최근 목적지 안내해줘"
            ],
            shortTitle: "최근 목적지 안내",
            systemImageName: "location.north"
        )
    }
}

enum AppIntentConfiguration {
    static var appGroupID: String {
        Bundle.main.object(forInfoDictionaryKey: "APP_GROUP_ID") as? String ?? "group.com.example.ParkingLotNavigator"
    }
}
