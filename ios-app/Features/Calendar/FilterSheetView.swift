import SwiftUI

struct FilterSheetView: View {
    @ObservedObject var filterModel: FestivalFilterModel
    @Environment(\.dismiss) private var dismiss

    @State private var draft: FestivalFilter

    init(filterModel: FestivalFilterModel) {
        self.filterModel = filterModel
        _draft = State(initialValue: filterModel.filter)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    radiusSection
                    statusSection
                    regionSection
                    tagSection
                }
                .padding(20)
            }
            .background(FestivalDesign.background)
            .navigationTitle("필터")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("초기화") {
                        draft = .default
                    }
                    .foregroundStyle(FestivalDesign.secondaryText)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("적용") {
                        filterModel.update(draft)
                        dismiss()
                    }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(FestivalDesign.coral)
                }
            }
        }
    }

    private var radiusSection: some View {
        sectionWrapper(title: "거리 반경", subtitle: "현재 위치 기준") {
            HStack(spacing: 8) {
                ForEach([10, 20, 50] as [Int], id: \.self) { km in
                    chip(label: "\(km)km", isOn: draft.radiusKm == km) {
                        draft.radiusKm = km
                    }
                }
                chip(label: "전국", isOn: draft.radiusKm == nil) {
                    draft.radiusKm = nil
                }
            }
        }
    }

    private var statusSection: some View {
        sectionWrapper(title: "진행 상태", subtitle: nil) {
            HStack(spacing: 8) {
                ForEach([DiscoverStatus.ongoing, .upcoming], id: \.self) { status in
                    chip(label: status.displayText, isOn: draft.statuses.contains(status)) {
                        toggle(status: status)
                    }
                }
            }
        }
    }

    private var regionSection: some View {
        sectionWrapper(title: "지역", subtitle: "여러 개 선택 가능") {
            FlowLayout(spacing: 6) {
                ForEach(Array(FestivalFilter.koreanRegions).sorted(), id: \.self) { region in
                    chip(label: region, isOn: draft.regions.contains(region)) {
                        toggle(region: region)
                    }
                }
            }
        }
    }

    private var tagSection: some View {
        sectionWrapper(title: "태그·장르", subtitle: "여러 개 선택 가능") {
            FlowLayout(spacing: 6) {
                ForEach(FestivalFilter.availableTagOptions, id: \.self) { tag in
                    chip(label: tag, isOn: draft.tags.contains(tag)) {
                        toggle(tag: tag)
                    }
                }
            }
        }
    }

    private func sectionWrapper<Content: View>(title: String, subtitle: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            content()
        }
    }

    private func chip(label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: isOn ? .bold : .semibold))
                .foregroundStyle(isOn ? FestivalDesign.surface : FestivalDesign.navy)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(isOn ? FestivalDesign.coral : FestivalDesign.surface)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(isOn ? FestivalDesign.coral : FestivalDesign.creamDeep.opacity(0.55), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func toggle(status: DiscoverStatus) {
        if let idx = draft.statuses.firstIndex(of: status) {
            draft.statuses.remove(at: idx)
        } else {
            draft.statuses.append(status)
        }
    }

    private func toggle(region: String) {
        if let idx = draft.regions.firstIndex(of: region) {
            draft.regions.remove(at: idx)
        } else {
            draft.regions.append(region)
        }
    }

    private func toggle(tag: String) {
        if let idx = draft.tags.firstIndex(of: tag) {
            draft.tags.remove(at: idx)
        } else {
            draft.tags.append(tag)
        }
    }
}

private struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var maxRowWidth: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if rowWidth + size.width > width {
                totalHeight += rowHeight + spacing
                maxRowWidth = max(maxRowWidth, rowWidth - spacing)
                rowWidth = size.width + spacing
                rowHeight = size.height
            } else {
                rowWidth += size.width + spacing
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        maxRowWidth = max(maxRowWidth, rowWidth - spacing)
        return CGSize(width: maxRowWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: size.width, height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
