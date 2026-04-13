import SwiftUI

struct FavoritesView: View {
    @EnvironmentObject private var store: DestinationStore
    @EnvironmentObject private var router: Router

    var body: some View {
        NavigationStack {
            List(store.favorites) { destination in
                Button {
                    router.showResults(for: destination)
                } label: {
                    DestinationRow(destination: destination)
                }
            }
            .navigationTitle("즐겨찾기")
            .overlay {
                if store.favorites.isEmpty {
                    Text("즐겨찾기가 없습니다.")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
