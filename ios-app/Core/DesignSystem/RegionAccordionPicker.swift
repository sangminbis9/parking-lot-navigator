import SwiftUI

/// 광역시도 → 하위 도시/구 계층으로 지역을 선택하는 아코디언 피커.
/// selected 배열에는 광역시도 단축명("경기")과 도시 키("수원시")가 함께 저장된다.
struct RegionAccordionPicker: View {
    @Binding var selected: [String]
    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(spacing: 2) {
            ForEach(FestivalFilter.regionHierarchy, id: \.name) { region in
                regionRow(region)
            }
        }
    }

    // MARK: - Region row

    private func regionRow(_ region: (name: String, cities: [String])) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                regionChip(region)
                Spacer(minLength: 8)
                if !region.cities.isEmpty {
                    expandButton(region.name)
                }
            }
            .padding(.vertical, 3)

            if expanded.contains(region.name) {
                cityGrid(region.cities)
                    .padding(.top, 6)
                    .padding(.bottom, 4)
                    .padding(.leading, 2)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private func regionChip(_ region: (name: String, cities: [String])) -> some View {
        let isOn = selected.contains(region.name)
        let cityCount = region.cities.filter { selected.contains($0) }.count
        let label = (!isOn && cityCount > 0) ? "\(region.name) +\(cityCount)" : region.name

        return Button {
            withAnimation(.easeInOut(duration: FestivalDesign.Motion.quick)) {
                if let idx = selected.firstIndex(of: region.name) {
                    selected.remove(at: idx)
                } else {
                    selected.append(region.name)
                }
            }
        } label: {
            Text(label)
                .font(.festival(size: 13, weight: isOn ? .bold : .semibold))
                .foregroundStyle(isOn ? FestivalDesign.onFill(FestivalDesign.coral) : FestivalDesign.navy)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(isOn ? FestivalDesign.coral : FestivalDesign.surface)
                .clipShape(FestivalDesign.chipShape)
                .overlay(
                    FestivalDesign.chipShape.stroke(
                        isOn ? FestivalDesign.coral : FestivalDesign.creamDeep.opacity(0.55),
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
    }

    private func expandButton(_ regionName: String) -> some View {
        let isExpanded = expanded.contains(regionName)
        return Button {
            withAnimation(.easeInOut(duration: FestivalDesign.Motion.standard)) {
                if isExpanded { expanded.remove(regionName) } else { expanded.insert(regionName) }
            }
        } label: {
            HStack(spacing: 3) {
                Text("도시")
                    .font(.festival(size: 11, weight: .semibold))
                Image(systemName: "chevron.down")
                    .font(.festival(size: 10, weight: .semibold))
                    .rotationEffect(isExpanded ? .degrees(180) : .zero)
            }
            .foregroundStyle(FestivalDesign.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
    }

    // MARK: - City grid

    private func cityGrid(_ cities: [String]) -> some View {
        RegionFlowLayout(spacing: 5) {
            ForEach(cities, id: \.self) { city in
                cityChip(city)
            }
        }
    }

    private func cityChip(_ city: String) -> some View {
        let isOn = selected.contains(city)
        let display = FestivalFilter.cityDisplayName(city)
        return Button {
            withAnimation(.easeInOut(duration: FestivalDesign.Motion.quick)) {
                if let idx = selected.firstIndex(of: city) {
                    selected.remove(at: idx)
                } else {
                    selected.append(city)
                }
            }
        } label: {
            Text(display)
                .font(.festival(size: 11, weight: isOn ? .bold : .regular))
                .foregroundStyle(isOn ? FestivalDesign.surface : FestivalDesign.secondaryText)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(isOn ? FestivalDesign.navy.opacity(0.85) : FestivalDesign.cream)
                .clipShape(FestivalDesign.chipShape)
                .overlay(
                    FestivalDesign.chipShape.stroke(
                        isOn ? FestivalDesign.navy.opacity(0.6) : FestivalDesign.creamDeep.opacity(0.45),
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - FlowLayout (shared)

/// 칩을 줄 바꿈하며 배치하는 레이아웃. FilterSheetView·NotificationSettingsView가 공유한다.
struct RegionFlowLayout: Layout {
    var spacing: CGFloat = 6

    /// 줄바꿈 판정 허용 오차. `sizeThatFits`가 돌려준 폭이 그대로 `placeSubviews`의 bounds가 되므로,
    /// 한 줄에 딱 맞는 경우 마지막 칩이 `x + width == maxX` 경계에 놓인다. 부동소수 오차로 이게
    /// 아주 살짝 초과하면 배치 단계에서만 줄이 바뀌고, 높이는 한 줄로 계산돼 있어 아래 뷰를 침범한다.
    private static let wrapTolerance: CGFloat = 0.5

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var maxRowWidth: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            // 줄의 첫 칩은 아무리 넓어도 그 줄에 둔다. 아니면 빈 줄만 쌓인다.
            if rowWidth > 0, rowWidth + size.width > maxWidth + Self.wrapTolerance {
                totalHeight += rowHeight + spacing
                maxRowWidth = max(maxRowWidth, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        maxRowWidth = max(maxRowWidth, rowWidth - spacing)
        return CGSize(width: min(maxRowWidth, maxWidth), height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX + Self.wrapTolerance {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            // 칸보다 넓은 칩은 폭을 잘라 제안한다. 그대로 두면 카드 밖으로 삐져나간다.
            let placedWidth = min(size.width, bounds.width)
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: placedWidth, height: size.height))
            x += placedWidth + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
