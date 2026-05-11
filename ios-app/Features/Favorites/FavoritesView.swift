import SwiftUI

struct FavoritesView: View {
    @EnvironmentObject private var store: DestinationStore
    @EnvironmentObject private var router: Router

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                favoritesHeader

                if store.favorites.isEmpty {
                    emptyState
                } else {
                    destinationSection(title: "저장한 목적지", destinations: store.favorites)
                }

                if !store.recents.isEmpty {
                    destinationSection(title: "최근 목적지", destinations: Array(store.recents.prefix(5)))
                }
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("즐겨찾기")
    }

    private var favoritesHeader: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 62, height: 62)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("다시 가고 싶은 장소")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("축제와 목적지를 저장해두면 주차 추천까지 빠르게 이어집니다.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FestivalDesign.cream.opacity(0.9), FestivalDesign.tealSoft],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image("FestivalMascotNight")
                .resizable()
                .scaledToFit()
                .frame(width: 140, height: 140)
                .accessibilityHidden(true)

            Text("아직 즐겨찾기가 없습니다")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            Text("마음에 드는 목적지를 저장하면 이곳에서 바로 찾을 수 있어요.")
                .font(.subheadline)
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
                .font(.headline)
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
}
