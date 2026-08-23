import CoreLocation
import SwiftUI

/// 지도 검색 전용 화면. 지도 위 검색 바를 누르면 같은 자리에서 이 화면으로 바뀐다.
/// 목적지(내비게이션) 검색은 다루지 않고, 이미 지도에 불러온 행사·가게 이벤트만 즉시 훑는다.
struct MapSearchOverlay: View {
    let festivals: [Festival]
    let performances: [PerformanceItem]
    let events: [FreeEvent]
    /// 지도 데이터가 갱신되면 검색 대상 목록도 다시 만든다.
    let dataRevision: Int
    let recents: [RecentDiscoverEntry]
    let referenceCoordinate: CLLocationCoordinate2D?
    let onSelect: (DiscoverTabItem) -> Void
    let onClearRecents: () -> Void
    let onClose: () -> Void

    /// 검색어가 바뀔 때마다 원본을 다시 훑지 않도록 한 번 만들어 둔다.
    @State private var allItems: [DiscoverTabItem] = []
    @State private var query = ""
    @State private var domains = MapSearchOverlay.allDomains
    @FocusState private var isFocused: Bool

    private static let allDomains: Set<DiscoverDomain> = [.festival, .localEvent, .performance, .tradeExpo]
    private static let domainOrder: [DiscoverDomain] = [.festival, .localEvent, .performance, .tradeExpo]
    private static let resultLimit = 40

    var body: some View {
        VStack(spacing: 0) {
            header
            content
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .onAppear { rebuildItems() }
        .onChange(of: dataRevision) { _ in rebuildItems() }
        .task {
            // 화면이 자리를 잡기 전에 포커스를 주면 키보드가 올라오지 않는 경우가 있다.
            try? await Task.sleep(nanoseconds: 150_000_000)
            isFocused = true
        }
    }

    // MARK: - 헤더

    /// 지도 헤더와 같은 간격·배경을 써서 검색 바가 제자리에 그대로 있는 것처럼 보이게 한다.
    private var header: some View {
        VStack(alignment: .leading, spacing: 9) {
            searchField
            domainToggles
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(FestivalDesign.barSurface.opacity(0.98))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(FestivalDesign.barBorder)
                .frame(height: 1)
        }
        .festivalShadow(.medium)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Button(action: onClose) {
                Image(systemName: "chevron.left")
                    .font(.festival(.subheadline, weight: .bold))
                    .foregroundStyle(FestivalDesign.tealText)
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\u{C9C0}\u{B3C4}\u{B85C} \u{B3CC}\u{C544}\u{AC00}\u{AE30}") // 지도로 돌아가기

            TextField(
                "",
                text: $query,
                prompt: Text("\u{D589}\u{C0AC}, \u{AC00}\u{AC8C} \u{C774}\u{BCA4}\u{D2B8} \u{AC80}\u{C0C9}") // 행사, 가게 이벤트 검색
                    .foregroundColor(FestivalDesign.secondaryText)
            )
            .font(.festival(.subheadline))
            .focused($isFocused)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.search)

            if !query.isEmpty {
                Button {
                    query = ""
                    isFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.festival(.subheadline))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .frame(width: 34, height: 34)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\u{AC80}\u{C0C9}\u{C5B4} \u{C9C0}\u{C6B0}\u{AE30}") // 검색어 지우기
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .background(FestivalDesign.surface)
        .clipShape(FestivalDesign.controlShape)
        .overlay(
            FestivalDesign.controlShape
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    /// 지도 레이어 토글과 같은 생김새지만, 지도 핀은 건드리지 않고 검색 범위만 가른다.
    private var domainToggles: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(Self.domainOrder, id: \.self) { domain in
                    domainToggle(domain)
                }
            }
        }
    }

    private func domainToggle(_ domain: DiscoverDomain) -> some View {
        let isOn = domains.contains(domain)
        return Button {
            if isOn {
                domains.remove(domain)
            } else {
                domains.insert(domain)
            }
        } label: {
            Label(domain.displayName, systemImage: symbol(for: domain))
                .font(.festival(.caption, weight: .bold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(isOn ? domain.tint : FestivalDesign.surface.opacity(0.92))
                .foregroundStyle(isOn ? onFillColor(domain) : FestivalDesign.secondaryText)
                .clipShape(FestivalDesign.controlShape)
                .overlay(
                    FestivalDesign.controlShape
                        .stroke(isOn ? Color.clear : FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOn ? "\u{CF1C}\u{C9D0}" : "\u{AEBC}\u{C9D0}") // 켜짐 / 꺼짐
    }

    /// 코랄 채움 위 대비는 자동 판정이 진한 잉크를 고르지만, 축제 토글은 지도와 같이 흰 글자가 맞다.
    private func onFillColor(_ domain: DiscoverDomain) -> Color {
        domain == .festival ? .white : FestivalDesign.onFill(domain.tint)
    }

    private func symbol(for domain: DiscoverDomain) -> String {
        switch domain {
        case .festival: return "sparkles"
        case .localEvent: return "tag.fill"
        case .performance: return "music.note"
        case .tradeExpo: return FestivalPrimaryCategory.tradeExpo.systemImage
        }
    }

    // MARK: - 본문

    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if trimmedQuery.isEmpty {
                    recentSection
                } else {
                    resultSection
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private var recentSection: some View {
        if recentItems.isEmpty {
            emptyState(
                symbol: "clock.arrow.circlepath",
                title: "\u{CD5C}\u{AE3C} \u{CC3E}\u{C544}\u{BCF8} \u{D589}\u{C0AC}\u{AC00} \u{C544}\u{C9C1} \u{C5C6}\u{C5B4}\u{C694}", // 최근 찾아본 행사가 아직 없어요
                message: "\u{C9C0}\u{B3C4}\u{C5D0}\u{C11C} \u{D589}\u{C0AC}\u{B098} \u{AC00}\u{AC8C} \u{C774}\u{BCA4}\u{D2B8}\u{B97C} \u{C5F4}\u{C5B4}\u{BCF4}\u{BA74} \u{C5EC}\u{AE30}\u{C5D0} \u{CE74}\u{B4DC}\u{B85C} \u{C313}\u{C5EC}\u{C694}" // 지도에서 행사나 가게 이벤트를 열어보면 여기에 카드로 쌓여요
            )
        } else {
            HStack {
                sectionTitle("\u{CD5C}\u{AE3C} \u{CC3E}\u{C544}\u{BCF8}") // 최근 찾아본
                Spacer()
                Button(action: onClearRecents) {
                    Text("\u{C9C0}\u{C6B0}\u{AE30}") // 지우기
                        .font(.festival(.caption, weight: .bold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                .buttonStyle(.plain)
            }
            ForEach(recentItems) { item in
                card(item)
            }
        }
    }

    @ViewBuilder
    private var resultSection: some View {
        let items = results
        if items.isEmpty {
            emptyState(
                symbol: "magnifyingglass",
                title: "\u{AC80}\u{C0C9} \u{ACB0}\u{ACFC}\u{AC00} \u{C5C6}\u{C5B4}\u{C694}", // 검색 결과가 없어요
                message: "\u{B2E4}\u{B978} \u{B2E8}\u{C5B4}\u{B85C} \u{CC3E}\u{AC70}\u{B098}, \u{C704} \u{D1A0}\u{AE00}\u{C744} \u{CF1C} \u{B354} \u{B9CE}\u{C740} \u{C885}\u{B958}\u{B97C} \u{D3EC}\u{D568}\u{D574} \u{BCF4}\u{C138}\u{C694}" // 다른 단어로 찾거나, 위 토글을 켜 더 많은 종류를 포함해 보세요
            )
        } else {
            sectionTitle("\u{AC80}\u{C0C9} \u{ACB0}\u{ACFC} \(items.count)\u{AC1C}") // 검색 결과 N개
            ForEach(items) { item in
                card(item)
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.festival(.caption, weight: .bold))
            .foregroundStyle(FestivalDesign.secondaryText)
    }

    private func card(_ item: DiscoverTabItem) -> some View {
        Button {
            onSelect(item)
        } label: {
            DiscoverTabRow(item: item)
                .padding(12)
                .festivalCard()
        }
        .buttonStyle(.plain)
    }

    private func emptyState(symbol: String, title: String, message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.festival(size: 30, weight: .semibold))
                .foregroundStyle(FestivalDesign.creamDeep)
            Text(title)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            Text(message)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    // MARK: - 데이터

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var recentItems: [DiscoverTabItem] {
        recents
            .map { entry -> DiscoverTabItem in
                switch entry {
                case .festival(let festival): return .festival(festival)
                case .event(let event): return .event(event)
                }
            }
            .filter { domains.contains($0.domain) }
    }

    private var results: [DiscoverTabItem] {
        let keyword = trimmedQuery.lowercased()
        guard !keyword.isEmpty else { return [] }
        let matched = allItems.filter { domains.contains($0.domain) && $0.searchText.contains(keyword) }
        return Array(
            matched
                .sorted { $0.meters(from: referenceCoordinate) < $1.meters(from: referenceCoordinate) }
                .prefix(Self.resultLimit)
        )
    }

    /// 축제 레이어와 공연 레이어에 같은 항목이 실려 오므로 id로 한 번 걸러 낸다.
    private func rebuildItems() {
        var seen = Set<String>()
        var items: [DiscoverTabItem] = []

        func append(_ item: DiscoverTabItem) {
            guard seen.insert(item.id).inserted else { return }
            items.append(item)
        }

        for festival in festivals {
            append(.festival(festival))
        }
        for performance in performances {
            switch performance {
            case .festival(let festival): append(.festival(festival))
            case .event(let event): append(.event(event))
            }
        }
        for event in events {
            append(.event(event))
        }

        allItems = items
    }
}
