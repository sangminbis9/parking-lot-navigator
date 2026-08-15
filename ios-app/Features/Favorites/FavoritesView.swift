import SwiftUI

struct FavoritesView: View {
    @EnvironmentObject private var store: DestinationStore
    @EnvironmentObject private var festivalFavorites: FestivalFavoritesStore
    @EnvironmentObject private var eventFavorites: LocalEventFavoritesStore
    @EnvironmentObject private var router: Router

    private var isEmpty: Bool {
        store.favorites.isEmpty && festivalFavorites.saved.isEmpty && eventFavorites.saved.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if isEmpty {
                    emptyState
                } else {
                    if !festivalFavorites.saved.isEmpty {
                        savedSection(
                            title: "저장한 축제",
                            items: festivalFavorites.saved.map { DiscoverTabItem.festival($0.asFestival) }
                        )
                    }
                    if !eventFavorites.saved.isEmpty {
                        savedSection(
                            title: "저장한 이벤트",
                            items: eventFavorites.saved.map { DiscoverTabItem.event($0.asEvent) }
                        )
                    }
                    if !store.favorites.isEmpty {
                        destinationSection(title: "저장한 목적지", destinations: store.favorites)
                    }
                }
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("즐겨찾기")
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image("FestivalMascotNight")
                .resizable()
                .scaledToFit()
                .frame(width: 140, height: 140)
                .accessibilityHidden(true)

            Text("아직 즐겨찾기가 없습니다")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            Text("마음에 드는 목적지를 저장하면 이곳에서 바로 찾을 수 있어요.")
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 18)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 34)
        .festivalCard()
    }

    private func destinationSection(title: String, destinations: [Destination]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            ForEach(destinations) { destination in
                Button {
                    router.showResults(for: destination)
                } label: {
                    DestinationRow(destination: destination)
                        .padding(12)
                        .festivalCard()
                }
                .buttonStyle(.plain)
            }
        }
    }

    // 이벤트/축제 카드는 검색 탭 목록(DiscoverTabRow)과 같은 생김새를 쓴다.
    private func savedSection(title: String, items: [DiscoverTabItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            ForEach(items) { item in
                Button {
                    router.showResults(for: item.destination, presentation: item.presentation)
                } label: {
                    DiscoverTabRow(item: item)
                        .padding(12)
                        .festivalCard()
                }
                .buttonStyle(.plain)
            }
        }
    }
}
