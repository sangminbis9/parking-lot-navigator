import AppIntents

struct ParkingAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FindParkingNearDestinationIntent(),
            phrases: [
                "\(.applicationName) 주차 찾기",
                "\(.applicationName) 목적지 주차"
            ],
            shortTitle: "주차 찾기",
            systemImageName: "parkingsign"
        )

        AppShortcut(
            intent: NavigateRecentDestinationIntent(),
            phrases: [
                "\(.applicationName) 최근 목적지",
                "\(.applicationName) 최근 길안내"
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
