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

                Divider()
                    .overlay(FestivalDesign.creamDeep.opacity(0.4))

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
                Text("주변 주차장 추천")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
            }

            Button {
                router.showNearbyParkingMap(destination: destination, recommendations: viewModel.recommendations)
            } label: {
                routePreviewCard
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isLoading)

            if viewModel.isLoading {
                LoadingStateView(text: "근처 주차장을 찾는 중입니다")
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
        HStack(spacing: 10) {
            Image(systemName: "map")
                .font(.festival(size: 17, weight: .semibold))
                .foregroundStyle(FestivalDesign.teal)
            Text("지도에서 주차장 보기")
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.festival(size: 13, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .festivalCard()
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

    @State private var page = 0
    @State private var showsViewer = false

    private var urls: [URL] {
        let sources = imageUrls.isEmpty
            ? [imageUrl].compactMap { $0 }
            : imageUrls
        return sources.compactMap { URL(string: $0) }
    }

    var body: some View {
        content
            .contentShape(Rectangle())
            .onTapGesture {
                guard !urls.isEmpty else { return }
                showsViewer = true
            }
            .fullScreenCover(isPresented: $showsViewer) {
                FullScreenImageViewer(urls: urls, startIndex: page)
            }
    }

    @ViewBuilder
    private var content: some View {
        if urls.count > 1 {
            TabView(selection: $page) {
                ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                    heroSlide(url: url)
                        .tag(index)
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
                RemoteImage(url: url, downsamplePoints: 500) {
                    Image("FestivalMascotGuide")
                        .resizable().scaledToFit().padding(28)
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
        RemoteImage(url: url, downsamplePoints: 500) {
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }
}

private struct DiscoverDescriptionCard: View {
    @Environment(\.openURL) private var openURL
    let presentation: DiscoverPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let description = clean(presentation.description) {
                detailSection(label: "행사 설명", value: description)
            }

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
            if presentation.isFestivalSource {
                detailRow(label: "장소", value: clean(presentation.venueName) ?? "장소 정보 없음")
            } else if let venueName = presentation.venueName, !venueName.isEmpty {
                detailRow(label: "장소", value: venueName)
            }
            detailRow(label: "주소", value: presentation.address)

            if presentation.isFestivalSource {
                detailRow(label: "이용요금", value: clean(presentation.admissionFee) ?? "요금 정보 없음")
                detailRow(label: "할인 정보", value: clean(presentation.discountInfo) ?? "할인 정보 없음")
                detailRow(label: "예매처", value: clean(presentation.bookingInfo) ?? "예매 없이 현장 참여 가능")
                detailRow(label: "관람 가능 연령", value: clean(presentation.ageLimit) ?? "연령 제한 없음")
                detailRow(label: "프로그램 상세", value: clean(presentation.programInfo) ?? "프로그램 정보 업데이트 예정")
                detailRow(label: "주최·주관", value: clean(presentation.organizerName) ?? "주최·주관 정보 없음")

                if let contactPhone = clean(presentation.contactPhone),
                   let telUrl = URL(string: "tel:\(contactPhone.filter { $0.isNumber || $0 == "+" })") {
                    Button {
                        openURL(telUrl)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("문의 전화번호")
                                    .font(.festival(.caption, weight: .semibold))
                                    .foregroundStyle(FestivalDesign.secondaryText)
                                Text(contactPhone)
                                    .font(.festival(.subheadline, weight: .semibold))
                                    .foregroundStyle(FestivalDesign.navy)
                            }
                            Spacer()
                            Image(systemName: "phone.fill")
                                .foregroundStyle(FestivalDesign.navy)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    detailRow(label: "문의 전화번호", value: clean(presentation.contactPhone) ?? "문의처 정보 없음")
                }
            }

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
