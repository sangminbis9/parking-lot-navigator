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
                    categorySection
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
                    .font(.festival(size: 15, weight: .bold))
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
        sectionWrapper(title: "기간", subtitle: nil) {
            HStack(spacing: 8) {
                ForEach(FestivalDateRange.allCases, id: \.self) { range in
                    chip(label: range.displayLabel, isOn: draft.dateRange == range) {
                        draft.dateRange = range
                    }
                }
            }
        }
    }

    private var regionSection: some View {
        sectionWrapper(title: "지역", subtitle: "도시 ▾ 를 눌러 세부 지역 선택") {
            RegionAccordionPicker(selected: $draft.regions)
        }
    }

    private var categorySection: some View {
        sectionWrapper(title: "카테고리", subtitle: "여러 개 선택 가능") {
            RegionFlowLayout(spacing: 6) {
                ForEach(FestivalPrimaryCategory.allCases, id: \.self) { category in
                    categoryChip(category: category, isOn: draft.primaryCategories.contains(category)) {
                        toggle(category: category)
                    }
                }
            }
        }
    }

    private func categoryChip(category: FestivalPrimaryCategory, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: category.systemImage)
                    .font(.festival(size: 11, weight: .bold))
                Text(category.displayName)
                    .font(.festival(size: 12, weight: isOn ? .bold : .semibold))
            }
            .foregroundStyle(isOn ? FestivalDesign.surface : FestivalDesign.navy)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isOn ? category.tint : FestivalDesign.surface)
            .clipShape(FestivalDesign.chipShape)
            .overlay(
                FestivalDesign.chipShape.stroke(isOn ? category.tint : FestivalDesign.creamDeep.opacity(0.55), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func sectionWrapper<Content: View>(title: String, subtitle: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title)
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                if let subtitle {
                    Text(subtitle)
                        .font(.festival(size: 11))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            content()
        }
    }

    private func chip(label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.festival(size: 12, weight: isOn ? .bold : .semibold))
                .foregroundStyle(isOn ? FestivalDesign.surface : FestivalDesign.navy)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(isOn ? FestivalDesign.coral : FestivalDesign.surface)
                .clipShape(FestivalDesign.chipShape)
                .overlay(
                    FestivalDesign.chipShape.stroke(isOn ? FestivalDesign.coral : FestivalDesign.creamDeep.opacity(0.55), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func toggle(category: FestivalPrimaryCategory) {
        if draft.primaryCategories.contains(category) {
            draft.primaryCategories.remove(category)
        } else {
            draft.primaryCategories.insert(category)
        }
    }
}
