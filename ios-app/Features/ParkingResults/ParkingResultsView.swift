import SwiftUI
import UIKit

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

    private var shareContent: DiscoverShareContent? {
        presentation?.shareContent(destinationId: destination.id)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let presentation {
                    DiscoverResultHeader(
                        presentation: presentation,
                        isFavorite: isFavorite,
                        onToggleFavorite: { toggleFavorite() },
                        shareContent: shareContent
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
                .foregroundStyle(FestivalDesign.tealText)
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
    var shareContent: DiscoverShareContent? = nil

    /// 태그·히어로 이미지 색은 그 행사의 분류 토글 색을 따른다.
    private var tint: Color {
        presentation.domain.tint
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DiscoverHeroImage(
                imageUrl: presentation.imageUrl,
                imageUrls: presentation.imageUrls,
                tint: tint
            )

            HStack(spacing: DiscoverTagStyle.Size.regular.spacing) {
                DiscoverTagChip(text: presentation.typeText, tint: tint, isLead: true)
                DiscoverTagChip(text: presentation.status.displayText, tint: tint)
                Spacer(minLength: 0)
                if let onToggleFavorite {
                    Button(action: onToggleFavorite) {
                        Image(systemName: isFavorite ? "star.fill" : "star")
                            .font(.festival(size: 20, weight: .semibold))
                            .foregroundStyle(isFavorite ? FestivalDesign.lanternText : FestivalDesign.secondaryText)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isFavorite ? "관심 축제 해제" : "관심 축제로 저장")
                }
                if let shareContent {
                    DiscoverShareButton(content: shareContent)
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

            // 첫 태그는 도메인이라 위 typeText 칩과 같다. 나머지만 뒤따르는 태그(옅은 배경)로 보여준다.
            let detailTags = Array(presentation.tags.dropFirst())
            if !detailTags.isEmpty {
                DiscoverTagRow(tags: detailTags, tint: tint, leadsRow: false)
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

/// 상세 정보 한 줄. 이모지·라벨·값이 한 벌로 움직여야 행 사이에 구분선을 넣기 쉬워
/// 뷰가 아니라 데이터로 모은다.
private struct DiscoverDetailEntry: Identifiable {
    let emoji: String
    let label: String
    let value: String
    /// 값 복사가 아니라 별도 동작이 있는 행(전화 걸기 등).
    var action: (url: URL, systemImage: String)? = nil
    var id: String { label }
}

private struct DiscoverDescriptionCard: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var toastCenter: ToastCenter
    let presentation: DiscoverPresentation
    /// 이모지 열 너비. 값 텍스트와 구분선의 시작점을 함께 맞추는 기준이다.
    @ScaledMetric(relativeTo: .subheadline) private var emojiColumn: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let description = clean(presentation.description) {
                detailSection(emoji: "\u{1F4DD}", label: "행사 설명", value: description)
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

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { rowSeparator }
                    entryRow(entry)
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    // 값이 없는 항목은 "정보 없음" 행으로 채우지 않고 감춘다.
    // 특히 예매처/연령 제한은 값이 없다고 해서 "예매 불필요", "제한 없음"이 사실인 것도 아니다.
    private var entries: [DiscoverDetailEntry] {
        var items: [DiscoverDetailEntry] = []
        items.append(DiscoverDetailEntry(emoji: "\u{1F4C5}", label: "일정", value: presentation.dateText))
        if let venueName = clean(presentation.venueName) {
            items.append(DiscoverDetailEntry(emoji: "\u{1F4CD}", label: "장소", value: venueName))
        }
        items.append(DiscoverDetailEntry(emoji: "\u{1F5FA}\u{FE0F}", label: "주소", value: presentation.address))

        if presentation.isFestivalSource {
            if let admissionFee = clean(presentation.admissionFee) {
                items.append(DiscoverDetailEntry(emoji: "\u{1F4B0}", label: "이용요금", value: admissionFee))
            }
            if let discountInfo = clean(presentation.discountInfo) {
                items.append(DiscoverDetailEntry(emoji: "\u{1F3F7}\u{FE0F}", label: "할인 정보", value: discountInfo))
            }
            if let bookingInfo = clean(presentation.bookingInfo) {
                items.append(DiscoverDetailEntry(emoji: "\u{1F3AB}", label: "예매처", value: bookingInfo))
            }
            if let ageLimit = clean(presentation.ageLimit) {
                items.append(DiscoverDetailEntry(emoji: "\u{1F465}", label: "관람 가능 연령", value: ageLimit))
            }
            if let organizerName = clean(presentation.organizerName) {
                items.append(DiscoverDetailEntry(emoji: "\u{1F3DB}\u{FE0F}", label: "주최·주관", value: organizerName))
            }
            if let contactPhone = clean(presentation.contactPhone) {
                let telUrl = URL(string: "tel:\(contactPhone.filter { $0.isNumber || $0 == "+" })")
                items.append(DiscoverDetailEntry(
                    emoji: "\u{260E}\u{FE0F}",
                    label: "문의 전화번호",
                    value: contactPhone,
                    action: telUrl.map { url in (url: url, systemImage: "phone.fill") }
                ))
            }
        }

        // 공연(KOPIS)은 축제 소스가 아니지만 출연진·공연시간을 programInfo로 받는다.
        // 축제 전용 블록 밖에 두어 두 도메인 모두 노출한다.
        if let programInfo = clean(presentation.programInfo) {
            items.append(DiscoverDetailEntry(emoji: "\u{1F4CB}", label: "프로그램 상세", value: programInfo))
        }
        if let price = clean(presentation.price) {
            items.append(DiscoverDetailEntry(emoji: "\u{1F4B5}", label: "\u{AC00}\u{ACA9}", value: price))
        }
        if let region = clean(presentation.region) {
            items.append(DiscoverDetailEntry(emoji: "\u{1F9ED}", label: "\u{C9C0}\u{C5ED}", value: region))
        }
        items.append(DiscoverDetailEntry(emoji: "\u{1F517}", label: "\u{CD9C}\u{CC98}", value: presentation.source))
        if let updatedAt = clean(presentation.updatedAt) {
            items.append(DiscoverDetailEntry(emoji: "\u{1F551}", label: "\u{C5C5}\u{B370}\u{C774}\u{D2B8}", value: updatedAt))
        }
        return items
    }

    /// 구분선은 이모지 열을 비켜 값 텍스트 시작점에서 그어 목록이 한 줄로 정렬돼 보이게 한다.
    private var rowSeparator: some View {
        Rectangle()
            .fill(FestivalDesign.creamDeep.opacity(0.45))
            .frame(height: 1)
            .padding(.leading, emojiColumn + 10)
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    // 값 영역은 꾹 눌러 직접 선택·복사할 수 있고, 한 번 탭하면 그 항목 전체가 클립보드로 간다.
    // 탭 제스처는 Text가 아니라 바깥 스택에 건다 — Text에 걸면 선택 제스처와 충돌한다.
    private func detailSection(emoji: String, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(emoji)
                    .font(.festival(.caption))
                    .accessibilityHidden(true)
                Text(label)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
            Text(value)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { copy(value) }
    }

    private func entryRow(_ entry: DiscoverDetailEntry) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(entry.emoji)
                .font(.festival(.subheadline))
                .frame(width: emojiColumn, alignment: .center)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.label)
                    .font(.festival(.caption, weight: .semibold))
                    .foregroundStyle(FestivalDesign.secondaryText)
                Text(entry.value)
                    .font(.festival(.subheadline, weight: .semibold))
                    .foregroundStyle(FestivalDesign.navy)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if let action = entry.action {
                Image(systemName: action.systemImage)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.navy)
            }
        }
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture {
            if let action = entry.action {
                openURL(action.url)
            } else {
                copy(entry.value)
            }
        }
    }

    private func copy(_ value: String) {
        UIPasteboard.general.string = value
        toastCenter.show("복사했습니다")
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
                        .foregroundStyle(FestivalDesign.tealText)
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
