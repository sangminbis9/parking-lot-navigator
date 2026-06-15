import SwiftUI

struct ParkingResultsView: View {
    let destination: Destination
    let apiClient: APIClientProtocol
    let presentation: DiscoverPresentation?
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var festivalFavorites: FestivalFavoritesStore
    @EnvironmentObject private var eventFavorites: LocalEventFavoritesStore
    @StateObject private var viewModel: ParkingResultsViewModel

    init(destination: Destination, apiClient: APIClientProtocol, presentation: DiscoverPresentation? = nil) {
        self.destination = destination
        self.apiClient = apiClient
        self.presentation = presentation
        _viewModel = StateObject(wrappedValue: ParkingResultsViewModel(destination: destination, apiClient: apiClient))
    }

    private var isFavorite: Bool {
        let rawId = destination.id.hasPrefix("festival-")
            ? String(destination.id.dropFirst("festival-".count))
            : destination.id.hasPrefix("event-")
                ? String(destination.id.dropFirst("event-".count))
                : destination.id
        if destination.normalizedCategory == "festival" {
            return festivalFavorites.contains(id: rawId)
        } else if destination.normalizedCategory == "event" {
            return eventFavorites.contains(id: rawId)
        }
        return false
    }

    private func toggleFavorite() {
        guard let presentation else { return }
        if destination.normalizedCategory == "festival" {
            festivalFavorites.toggle(SavedFestival(destination: destination, presentation: presentation))
        } else if destination.normalizedCategory == "event" {
            eventFavorites.toggle(SavedEvent(destination: destination, presentation: presentation))
        }
    }

    private var shareURL: URL {
        if let sourceUrl = presentation?.sourceUrl,
           let url = URL(string: sourceUrl) {
            return url
        }
        return DeepLinkRouter.shared.urlForDestination(id: destination.id)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let presentation {
                    DiscoverResultHeader(
                        presentation: presentation,
                        isFavorite: isFavorite,
                        onToggleFavorite: { toggleFavorite() },
                        shareURL: shareURL
                    )
                    DiscoverDescriptionCard(presentation: presentation)
                } else {
                    ParkingGuideHeader(destination: destination)
                }

                parkingRecommendationSection
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("주차 추천")
        .task { await viewModel.load() }
    }

    private var parkingRecommendationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image("FestivalMascotIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 34, height: 34)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("주변 주차장 추천")
                        .font(.festival(.headline))
                        .foregroundStyle(FestivalDesign.navy)
                    Text("축제 정보 확인 후 바로 이동할 수 있게 아래에 모아뒀어요.")
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }

            routePreviewCard

            if viewModel.isLoading {
                LoadingStateView(text: "방문할 축제 근처 주차장을 찾는 중입니다")
                    .frame(height: 160)
                    .padding()
                    .festivalCard()
            } else if let errorMessage = viewModel.errorMessage {
                FailureStateView(message: errorMessage) { Task { await viewModel.load() } }
                    .frame(maxWidth: .infinity)
                    .festivalCard()
            } else if viewModel.isEmptyResult {
                ParkingEmptyStateView()
                    .frame(maxWidth: .infinity)
                    .festivalCard()
            } else {
                ForEach(viewModel.recommendations) { recommendation in
                    Button {
                        router.showDetail(destination: destination, parkingLot: recommendation.parkingLot)
                    } label: {
                        ParkingLotRow(recommendation: recommendation)
                            .padding(12)
                            .festivalCard()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var routePreviewCard: some View {
        ZStack {
            LinearGradient(
                colors: [FestivalDesign.tealSoft, FestivalDesign.cream.opacity(0.65)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            VStack(spacing: 10) {
                Image(systemName: "map")
                    .font(.festival(size: 34, weight: .semibold))
                    .foregroundStyle(FestivalDesign.teal)
                Text("목적지 주변 주차 미리보기")
                    .font(.festival(.subheadline, weight: .semibold))
                    .foregroundStyle(FestivalDesign.navy)
                Text("상세 화면에서 경로와 실시간 정보를 이어서 확인할 수 있어요.")
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
        .frame(height: 160)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }
}

private struct ParkingEmptyStateView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "parkingsign.circle")
                .font(.festival(size: 34, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text("추천할 주변 주차장이 없어요")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            Text("이 목적지 반경 800m 안에서 안내할 수 있는 주차장을 찾지 못했어요.")
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding()
    }
}

private struct DiscoverResultHeader: View {
    let presentation: DiscoverPresentation
    var isFavorite: Bool = false
    var onToggleFavorite: (() -> Void)? = nil
    var shareURL: URL? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DiscoverHeroImage(
                imageUrl: presentation.imageUrl,
                imageUrls: presentation.imageUrls,
                tint: presentation.status == .ongoing ? FestivalDesign.coral : FestivalDesign.teal
            )

            HStack(spacing: 8) {
                StatusBadge(text: presentation.typeText, kind: .source)
                StatusBadge(text: presentation.status.displayText, kind: presentation.status == .ongoing ? .realtime : .neutral)
                Spacer(minLength: 0)
                if let onToggleFavorite {
                    Button(action: onToggleFavorite) {
                        Image(systemName: isFavorite ? "star.fill" : "star")
                            .font(.festival(size: 20, weight: .semibold))
                            .foregroundStyle(isFavorite ? FestivalDesign.lantern : FestivalDesign.secondaryText)
                    }
                    .buttonStyle(.plain)
                }
                if let shareURL {
                    ShareLink(item: shareURL) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.festival(size: 18, weight: .semibold))
                            .foregroundStyle(FestivalDesign.secondaryText)
                    }
                }
                Text(presentation.source)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }

            Text(presentation.title)
                .font(.festival(.title3, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)

            if let subtitle = presentation.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .festivalCard()
    }
}

private struct DiscoverHeroImage: View {
    let imageUrl: String?
    let imageUrls: [String]
    let tint: Color

    private var urls: [URL] {
        let sources = imageUrls.isEmpty
            ? [imageUrl].compactMap { $0 }
            : imageUrls
        return sources.compactMap { URL(string: $0) }
    }

    var body: some View {
        if urls.count > 1 {
            TabView {
                ForEach(urls, id: \.absoluteString) { url in
                    heroSlide(url: url)
                        .tag(url)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .frame(height: 210)
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                    .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
            )
        } else {
            singleImage
        }
    }

    private var singleImage: some View {
        ZStack {
            LinearGradient(
                colors: [tint.opacity(0.18), FestivalDesign.cream.opacity(0.62)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let url = urls.first {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Image("FestivalMascotGuide")
                            .resizable().scaledToFit().padding(28)
                    }
                }
            } else {
                Image("FestivalMascotGuide")
                    .resizable().scaledToFit().padding(26)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 190)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
        .clipped()
    }

    private func heroSlide(url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            default:
                ZStack {
                    LinearGradient(
                        colors: [tint.opacity(0.18), FestivalDesign.cream.opacity(0.62)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image("FestivalMascotGuide")
                        .resizable().scaledToFit().padding(28)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }
}

private struct DiscoverDescriptionCard: View {
    @Environment(\.openURL) private var openURL
    let presentation: DiscoverPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            detailSection(label: "\u{D589}\u{C0AC} \u{C124}\u{BA85}", value: descriptionText)

            if let sourceUrl = clean(presentation.sourceUrl), let url = URL(string: sourceUrl) {
                Button {
                    openURL(url)
                } label: {
                    Label("\u{C790}\u{C138}\u{D788} \u{C54C}\u{C544}\u{BCF4}\u{AE30}", systemImage: "safari")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(FestivalDesign.navy)
            }

            detailRow(label: "일정", value: presentation.dateText)
            if let venueName = presentation.venueName, !venueName.isEmpty {
                detailRow(label: "장소", value: venueName)
            }
            detailRow(label: "주소", value: presentation.address)

            if let price = clean(presentation.price) {
                detailRow(label: "\u{AC00}\u{ACA9}", value: price)
            }
            if let region = clean(presentation.region) {
                detailRow(label: "\u{C9C0}\u{C5ED}", value: region)
            }
            detailRow(label: "\u{CD9C}\u{CC98}", value: presentation.source)
            if let updatedAt = clean(presentation.updatedAt) {
                detailRow(label: "\u{C5C5}\u{B370}\u{C774}\u{D2B8}", value: updatedAt)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var descriptionText: String {
        if let description = clean(presentation.description) {
            return description
        }
        let venueText = clean(presentation.venueName) ?? presentation.address
        let priceText = clean(presentation.price).map { " \u{AC00}\u{ACA9}: \($0)." } ?? ""
        return "\(presentation.title) \u{D589}\u{C0AC}\u{B294} \(presentation.dateText)\u{C5D0} \(venueText)\u{C5D0}\u{C11C} \u{C9C4}\u{D589}\u{B418}\u{B294} \(presentation.typeText)\u{C785}\u{B2C8}\u{B2E4}.\(priceText) \u{C790}\u{C138}\u{D55C} \u{B0B4}\u{C6A9}\u{C740} \(presentation.source)\u{C758} \u{C6D0}\u{BCF8} \u{B370}\u{C774}\u{D130} \u{C81C}\u{ACF5} \u{BC94}\u{C704}\u{C5D0} \u{B530}\u{B77C} \u{D45C}\u{C2DC}\u{B429}\u{B2C8}\u{B2E4}."
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func detailSection(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func detailRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ParkingGuideHeader: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image("FestivalMascotIcon")
                .resizable()
                .scaledToFit()
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(destination.name)
                    .font(.festival(.title3, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Text(destination.address)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
                StatusBadge(text: "반경 800m", kind: .source)
            }
            Spacer()
        }
        .padding(14)
        .festivalCard()
    }
}

struct ParkingLotRow: View {
    let recommendation: ParkingRecommendation

    private var parkingLot: ParkingLot {
        recommendation.parkingLot
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(parkingLot.name)
                        .font(.festival(.headline))
                        .foregroundStyle(FestivalDesign.navy)
                        .lineLimit(2)
                    Text(parkingLot.address)
                        .font(.festival(.subheadline))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(recommendation.scorePercent)점")
                        .font(.festival(.subheadline, weight: .semibold))
                        .foregroundStyle(FestivalDesign.teal)
                    Text("\(parkingLot.distanceFromDestinationMeters)m")
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }

            Text(recommendation.primaryReason)
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    StatusBadge(text: parkingLot.displayStatus, kind: parkingLot.stale ? .warning : (parkingLot.realtimeAvailable ? .realtime : .neutral))
                    StatusBadge(text: parkingLot.isPublic ? "공영" : "민영", kind: .source)
                    ForEach(recommendation.badges.prefix(3), id: \.self) { badge in
                        StatusBadge(text: badge, kind: .neutral)
                    }
                    if parkingLot.supportsEv { StatusBadge(text: "EV", kind: .neutral) }
                    if parkingLot.supportsAccessible { StatusBadge(text: "교통약자", kind: .neutral) }
                }
            }
        }
        .foregroundStyle(FestivalDesign.navy)
    }
}
