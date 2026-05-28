import SwiftUI

struct ParkingResultsView: View {
    let destination: Destination
    let apiClient: APIClientProtocol
    let presentation: DiscoverPresentation?
    @EnvironmentObject private var router: Router
    @StateObject private var viewModel: ParkingResultsViewModel

    init(destination: Destination, apiClient: APIClientProtocol, presentation: DiscoverPresentation? = nil) {
        self.destination = destination
        self.apiClient = apiClient
        self.presentation = presentation
        _viewModel = StateObject(wrappedValue: ParkingResultsViewModel(destination: destination, apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let presentation {
                    DiscoverResultHeader(presentation: presentation)
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
                        .font(.headline)
                        .foregroundStyle(FestivalDesign.navy)
                    Text("축제 정보 확인 후 바로 이동할 수 있게 아래에 모아뒀어요.")
                        .font(.caption)
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
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(FestivalDesign.teal)
                Text("목적지 주변 주차 미리보기")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(FestivalDesign.navy)
                Text("상세 화면에서 경로와 실시간 정보를 이어서 확인할 수 있어요.")
                    .font(.caption)
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

private struct DiscoverResultHeader: View {
    let presentation: DiscoverPresentation

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
                Text(presentation.source)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }

            Text(presentation.title)
                .font(.title3.weight(.bold))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)

            if let subtitle = presentation.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
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

            if let sourceUrl = clean(presentation.sourceUrl), let url = URL(string: sourceUrl) {
                Button {
                    openURL(url)
                } label: {
                    Label("\u{ACF5}\u{C2DD} \u{C815}\u{BCF4} \u{C5F4}\u{AE30}", systemImage: "safari")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(FestivalDesign.navy)
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
                .font(.caption.weight(.semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func detailRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
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
                    .font(.title3.weight(.bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Text(destination.address)
                    .font(.subheadline)
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
                        .font(.headline)
                        .foregroundStyle(FestivalDesign.navy)
                        .lineLimit(2)
                    Text(parkingLot.address)
                        .font(.subheadline)
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text("\(recommendation.scorePercent)점")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(FestivalDesign.teal)
                    Text("\(parkingLot.distanceFromDestinationMeters)m")
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }

            Text(recommendation.primaryReason)
                .font(.subheadline.weight(.semibold))
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
