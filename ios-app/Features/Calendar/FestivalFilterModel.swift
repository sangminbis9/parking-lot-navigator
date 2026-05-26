import Foundation

@MainActor
final class FestivalFilterModel: ObservableObject {
    @Published var filter: FestivalFilter

    private let appGroupID: String

    init(appGroupID: String) {
        self.appGroupID = appGroupID
        self.filter = FestivalFilterStore.load(appGroupID: appGroupID)
    }

    func update(_ newFilter: FestivalFilter) {
        filter = newFilter
        FestivalFilterStore.save(newFilter, appGroupID: appGroupID)
    }
}
