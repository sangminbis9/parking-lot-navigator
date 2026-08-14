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
                        savedSection(title: "저장한 축제", items: festivalFavorites.saved) { $0.destination }
                            presentation: { $0.presentation }
                    }
                    if !eventFavorites.saved.isEmpty {
                        savedSection(title: "저장한 이벤트", items: eventFavorites.saved) { $0.destination }
                            presentation: { $0.presentation }
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

    private func savedSection<T: Identifiable>(
        title: String,
        items: [T],
        destination: @escaping (T) -> Destination,
        presentation: @escaping (T) -> DiscoverPresentation
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            ForEach(items) { item in
                HStack(spacing: 0) {
                    Button {
                        router.showResults(for: destination(item), presentation: presentation(item))
                    } label: {
                        DestinationRow(destination: destination(item))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    DiscoverShareButton(
                        content: presentation(item).shareContent(destinationId: destination(item).id),
                        iconSize: 16,
                        tapSize: 40
                    )
                    .padding(.trailing, 4)
                }
                .festivalCard()
            }
        }
    }
}
