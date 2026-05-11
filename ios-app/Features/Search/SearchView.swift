import CoreLocation
import SwiftUI

struct SearchView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var tabRouter: AppTabRouter
    @EnvironmentObject private var destinationStore: DestinationStore
    @State private var festivals: [Festival] = []
    @State private var events: [FreeEvent] = []
    @State private var query = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @FocusState private var isSearchFocused: Bool

    private let koreaCenter = CLLocationCoordinate2D(latitude: 36.35, longitude: 127.80)
    private let discoverRadiusMeters = 460_000

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                discoverHeader
                searchCard

                if isLoading {
                    LoadingStateView(text: "축제와 이벤트를 불러오는 중입니다")
                        .frame(height: 130)
                        .padding()
                        .festivalCard()
                }

                if let errorMessage {
                    FailureStateView(message: errorMessage) {
                        Task { await loadDiscoverItems() }
                    }
                    .festivalCard()
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("축제와 이벤트")
                            .font(.headline)
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(text: "\(filteredItems.count)개", kind: .source)
                    }

                    if filteredItems.isEmpty && !isLoading {
                        emptyState
                    } else {
                        ForEach(filteredItems) { item in
                            Button {
                                isSearchFocused = false
                                destinationStore.addRecent(item.destination)
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
                .contentShape(Rectangle())
                .simultaneousGesture(TapGesture().onEnded {
                    isSearchFocused = false
                })
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("축제")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            applyPendingDiscoverFilter()
        }
        .onChange(of: tabRouter.discoverFilterQuery) { _ in
            applyPendingDiscoverFilter()
        }
        .task { await loadDiscoverItemsIfNeeded() }
    }

    private func applyPendingDiscoverFilter() {
        guard let filter = tabRouter.discoverFilterQuery else { return }
        query = filter
        tabRouter.discoverFilterQuery = nil
    }

    private var discoverHeader: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("지금 가볼 만한 축제")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("목록에서 장소를 고르면 근처 주차장을 바로 추천합니다.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
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

    private var searchCard: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(FestivalDesign.teal)
            TextField(
                "",
                text: $query,
                prompt: Text("축제, 이벤트, 장소 검색")
                    .foregroundColor(FestivalDesign.secondaryText)
            )
            .focused($isSearchFocused)
            .textInputAutocapitalization(.never)
            .submitLabel(.search)

            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .festivalCard()
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image("FestivalMascotNight")
                .resizable()
                .scaledToFit()
                .frame(width: 132, height: 132)
                .accessibilityHidden(true)
            Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "표시할 축제가 없습니다" : "검색 결과가 없습니다")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            Text("검색어를 바꾸거나 잠시 후 다시 확인해 주세요.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .festivalCard()
    }

    private var allItems: [DiscoverTabItem] {
        festivals.map(DiscoverTabItem.festival) + events.map(DiscoverTabItem.event)
    }

    private var filteredItems: [DiscoverTabItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let items = trimmed.isEmpty ? allItems : allItems.filter { $0.searchText.contains(trimmed) }
        return items.sorted {
            if $0.status != $1.status { return $0.status == .ongoing }
            if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
            return $0.title < $1.title
        }
    }

    private func loadDiscoverItemsIfNeeded() async {
        guard festivals.isEmpty && events.isEmpty else { return }
        await loadDiscoverItems()
    }

    private func loadDiscoverItems() async {
        isLoading = true
        errorMessage = nil
        do {
            async let festivalItems = apiClient.nearbyFestivals(
                lat: koreaCenter.latitude,
                lng: koreaCenter.longitude,
                radiusMeters: discoverRadiusMeters
            )
            async let eventItems = apiClient.nearbyEvents(
                lat: koreaCenter.latitude,
                lng: koreaCenter.longitude,
                radiusMeters: discoverRadiusMeters
            )
            festivals = try await festivalItems
            events = try await eventItems
        } catch {
            errorMessage = "축제와 이벤트 정보를 불러오지 못했습니다."
        }
        isLoading = false
    }
}

private struct DiscoverTabItem: Identifiable {
    enum Kind {
        case festival(Festival)
        case event(FreeEvent)
    }

    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let address: String
    let dateText: String
    let startDate: String
    let status: DiscoverStatus
    let typeText: String
    let source: String
    let imageUrl: String?
    let searchText: String
    let destination: Destination
    let presentation: DiscoverPresentation

    static func festival(_ festival: Festival) -> DiscoverTabItem {
        DiscoverTabItem(
            id: "festival-\(festival.id)",
            kind: .festival(festival),
            title: festival.title,
            subtitle: festival.subtitle ?? festival.venueName ?? festival.address,
            address: festival.address,
            dateText: "\(festival.startDate) - \(festival.endDate)",
            startDate: festival.startDate,
            status: festival.status,
            typeText: "축제",
            source: festival.source,
            imageUrl: festival.imageUrl,
            searchText: [
                festival.title,
                festival.subtitle,
                festival.venueName,
                festival.address,
                festival.source,
                festival.tags.joined(separator: " ")
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: Destination(
                id: "festival-\(festival.id)",
                name: festival.title,
                address: festival.address,
                lat: festival.lat,
                lng: festival.lng,
                source: festival.source,
                rawCategory: festival.tags.joined(separator: ","),
                normalizedCategory: "festival"
            ),
            presentation: DiscoverPresentation(
                title: festival.title,
                subtitle: festival.subtitle,
                dateText: "\(festival.startDate) - \(festival.endDate)",
                venueName: festival.venueName,
                address: festival.address,
                status: festival.status,
                typeText: "축제",
                source: festival.source,
                imageUrl: festival.imageUrl,
                tags: festival.tags
            )
        )
    }

    static func event(_ event: FreeEvent) -> DiscoverTabItem {
        DiscoverTabItem(
            id: "event-\(event.id)",
            kind: .event(event),
            title: event.title,
            subtitle: event.shortDescription ?? event.venueName ?? event.address,
            address: event.address,
            dateText: "\(event.startDate) - \(event.endDate)",
            startDate: event.startDate,
            status: event.status,
            typeText: event.eventType.isEmpty ? "이벤트" : event.eventType,
            source: event.source,
            imageUrl: event.imageUrl,
            searchText: [
                event.title,
                event.eventType,
                event.venueName,
                event.address,
                event.source,
                event.shortDescription
            ].compactMap { $0 }.joined(separator: " ").lowercased(),
            destination: Destination(
                id: "event-\(event.id)",
                name: event.title,
                address: event.address,
                lat: event.lat,
                lng: event.lng,
                source: event.source,
                rawCategory: event.eventType,
                normalizedCategory: "event"
            ),
            presentation: DiscoverPresentation(
                title: event.title,
                subtitle: event.shortDescription,
                dateText: "\(event.startDate) - \(event.endDate)",
                venueName: event.venueName,
                address: event.address,
                status: event.status,
                typeText: event.eventType.isEmpty ? "이벤트" : event.eventType,
                source: event.source,
                imageUrl: event.imageUrl,
                tags: [event.eventType].filter { !$0.isEmpty }
            )
        )
    }
}

private struct DiscoverTabRow: View {
    let item: DiscoverTabItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DiscoverTabThumbnail(imageUrl: item.imageUrl, isFestival: item.typeText == "축제")

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    StatusBadge(text: item.typeText, kind: .source)
                    StatusBadge(text: item.status.displayText, kind: item.status == .ongoing ? .realtime : .neutral)
                }
                Text(item.title)
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Text(item.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
                Text(item.dateText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(FestivalDesign.teal)
                Text(item.address)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct DiscoverTabThumbnail: View {
    let imageUrl: String?
    let isFestival: Bool

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    (isFestival ? FestivalDesign.coral : FestivalDesign.teal).opacity(0.15),
                    FestivalDesign.cream.opacity(0.48)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Image("FestivalMascotIcon")
                            .resizable()
                            .scaledToFit()
                            .padding(14)
                    }
                }
            } else {
                Image("FestivalMascotIcon")
                    .resizable()
                    .scaledToFit()
                    .padding(14)
            }
        }
        .frame(width: 82, height: 82)
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
    }
}

struct DestinationRow: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill")
                .foregroundStyle(FestivalDesign.coral)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(destination.name)
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text(destination.address)
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
        }
    }
}
