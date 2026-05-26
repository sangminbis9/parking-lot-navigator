import Foundation

@MainActor
final class FestivalFilterModel: ObservableObject {
    @Published var filter: FestivalFilter

    private let scope: String
    private let appGroupID: String

    init(scope: String, appGroupID: String) {
        self.scope = scope
        self.appGroupID = appGroupID
        self.filter = FestivalFilterStore.load(scope: scope, appGroupID: appGroupID)
    }

    func update(_ newFilter: FestivalFilter) {
        filter = newFilter
        FestivalFilterStore.save(newFilter, scope: scope, appGroupID: appGroupID)
    }
}
