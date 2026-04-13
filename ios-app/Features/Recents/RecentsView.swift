import SwiftUI

struct RecentsView: View {
    @EnvironmentObject private var store: DestinationStore
    @EnvironmentObject private var router: Router

    var body: some View {
        NavigationStack {
            List(store.recents) { destination in
                Button {
                    router.showResults(for: destination)
                } label: {
                    DestinationRow(destination: destination)
                }
            }
            .navigationTitle("최근 목적지")
            .overlay {
                if store.recents.isEmpty {
                    Text("최근 목적지가 없습니다.")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
