import SwiftUI
import UserNotifications

struct NotificationSettingsView: View {
    @EnvironmentObject private var model: NotificationPreferencesModel
    @EnvironmentObject private var discoveryService: DiscoveryNotificationService
    @Environment(\.openURL) private var openURL

    @State private var permissionDenied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                introCard
                if permissionDenied {
                    permissionBanner
                }
                festivalSection
                localEventSection
                commonSection
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("알림")
        .task { await refreshPermissionState() }
        .onChange(of: model.prefs.festival.discoveryEnabled) { enabled in
            handleDiscoveryToggle(enabled)
        }
        .onChange(of: model.prefs.localEvent.discoveryEnabled) { enabled in
            handleDiscoveryToggle(enabled)
        }
    }

    // MARK: - 상단 안내 / 권한

    private var introCard: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(FestivalDesign.cream)
                Image(systemName: "bell.badge.fill")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.coral)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 3) {
                Text("관심 알림 받기")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Text("관심 지역·카테고리에 새 축제나 로컬 이벤트가 생기면 알려드려요. 기기 상태에 따라 알림 시점은 다소 늦어질 수 있습니다.")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .festivalCard()
    }

    private var permissionBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(FestivalDesign.coral)
                Text("알림 권한이 꺼져 있어요")
                    .font(.festival(.subheadline, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
            }
            Text("iOS 설정에서 알림을 허용해야 새 소식을 받을 수 있습니다.")
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            } label: {
                Text("설정 열기")
                    .font(.festival(.subheadline, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.vertical, 8)
                    .padding(.horizontal, 14)
                    .background(FestivalDesign.navy)
                    .clipShape(FestivalDesign.controlShape)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(FestivalDesign.coral.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.coral.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - 축제 알림

    private var festivalSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("축제 알림", systemImage: "ticket.fill")

            Toggle(isOn: boolBinding(\.festival.discoveryEnabled)) {
                toggleLabel("새 축제 발견 알림", "관심 조건에 맞는 새 축제를 알려드려요")
            }
            .tint(FestivalDesign.coral)

            if model.prefs.festival.discoveryEnabled {
                Divider()
                fieldTitle("카테고리", "비워두면 전체")
                festivalCategoryChips
                fieldTitle("지역", "비워두면 현재 위치 반경")
                regionChips(selected: model.prefs.festival.regions) { toggleFestivalRegion($0) }
                if model.prefs.festival.regions.isEmpty {
                    fieldTitle("반경", nil)
                    radiusChips(selected: model.prefs.festival.radiusKm) { model.prefs.festival.radiusKm = $0 }
                }
            }

            Divider()

            Toggle(isOn: boolBinding(\.festival.savedReminderEnabled)) {
                toggleLabel("저장한 축제 리마인더", "캘린더에서 저장한 축제 시작 전 알림")
            }
            .tint(FestivalDesign.coral)

            if model.prefs.festival.savedReminderEnabled {
                Picker("알림 시점", selection: intBinding(\.festival.leadDays)) {
                    ForEach(FestivalNotificationPrefs.allLeadDayOptions, id: \.self) { days in
                        Text(leadDayLabel(days)).tag(days)
                    }
                }
                .pickerStyle(.segmented)

                DatePicker(
                    "알림 시각",
                    selection: hourBinding(\.festival.reminderHour),
                    displayedComponents: .hourAndMinute
                )
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var festivalCategoryChips: some View {
        FlowLayout(spacing: 6) {
            ForEach(FestivalPrimaryCategory.allCases, id: \.self) { category in
                categoryChip(
                    label: category.displayName,
                    systemImage: category.systemImage,
                    tint: category.tint,
                    isOn: model.prefs.festival.categories.contains(category)
                ) {
                    toggleFestivalCategory(category)
                }
            }
        }
    }

    // MARK: - 로컬 이벤트 알림

    private var localEventSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("로컬 이벤트 알림", systemImage: "storefront.fill")

            Toggle(isOn: boolBinding(\.localEvent.discoveryEnabled)) {
                toggleLabel("새 이벤트 발견 알림", "관심 조건에 맞는 새 로컬 이벤트를 알려드려요")
            }
            .tint(FestivalDesign.coral)

            if model.prefs.localEvent.discoveryEnabled {
                Divider()
                fieldTitle("카테고리", "비워두면 전체")
                localEventCategoryChips
                fieldTitle("지역", "비워두면 현재 위치 반경")
                regionChips(selected: model.prefs.localEvent.regions) { toggleLocalEventRegion($0) }
                if model.prefs.localEvent.regions.isEmpty {
                    fieldTitle("반경", nil)
                    radiusChips(selected: model.prefs.localEvent.radiusKm) { model.prefs.localEvent.radiusKm = $0 }
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var localEventCategoryChips: some View {
        FlowLayout(spacing: 6) {
            ForEach(LocalEventPrimaryCategory.allCases, id: \.self) { category in
                categoryChip(
                    label: category.displayName,
                    systemImage: category.systemImage,
                    tint: category.tint,
                    isOn: model.prefs.localEvent.categories.contains(category)
                ) {
                    toggleLocalEventCategory(category)
                }
            }
        }
    }

    // MARK: - 공통

    private var commonSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionTitle("공통", systemImage: "moon.zzz.fill")

            Toggle(isOn: boolBinding(\.quietHoursEnabled)) {
                toggleLabel("방해 금지 시간", "이 시간대에는 알림을 보내지 않아요")
            }
            .tint(FestivalDesign.coral)

            if model.prefs.quietHoursEnabled {
                DatePicker("시작", selection: hourBinding(\.quietStartHour), displayedComponents: .hourAndMinute)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.navy)
                DatePicker("종료", selection: hourBinding(\.quietEndHour), displayedComponents: .hourAndMinute)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.navy)
            }

        }
        .padding(14)
        .festivalCard()
    }

    // MARK: - 공용 컴포넌트

    private func sectionTitle(_ title: String, systemImage: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.festival(.subheadline, weight: .bold))
                .foregroundStyle(FestivalDesign.coral)
            Text(title)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
        }
    }

    private func toggleLabel(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
            Text(subtitle)
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func fieldTitle(_ title: String, _ subtitle: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title)
                .font(.festival(size: 13, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            if let subtitle {
                Text(subtitle)
                    .font(.festival(size: 11))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
        }
    }

    private func regionChips(selected: [String], toggle: @escaping (String) -> Void) -> some View {
        FlowLayout(spacing: 6) {
            ForEach(Array(FestivalFilter.koreanRegions).sorted(), id: \.self) { region in
                plainChip(label: region, isOn: selected.contains(region)) {
                    toggle(region)
                }
            }
        }
    }

    private func radiusChips(selected: Int, set: @escaping (Int) -> Void) -> some View {
        HStack(spacing: 8) {
            ForEach(NotificationPreferences.allRadiusOptions, id: \.self) { km in
                plainChip(label: "\(km)km", isOn: selected == km) { set(km) }
            }
        }
    }

    private func categoryChip(label: String, systemImage: String, tint: Color, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.festival(size: 11, weight: .bold))
                Text(label)
                    .font(.festival(size: 12, weight: isOn ? .bold : .semibold))
            }
            .foregroundStyle(isOn ? FestivalDesign.surface : FestivalDesign.navy)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isOn ? tint : FestivalDesign.surface)
            .clipShape(FestivalDesign.chipShape)
            .overlay(
                FestivalDesign.chipShape.stroke(isOn ? tint : FestivalDesign.creamDeep.opacity(0.55), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func plainChip(label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
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

    // MARK: - 바인딩 헬퍼

    private func boolBinding(_ keyPath: WritableKeyPath<NotificationPreferences, Bool>) -> Binding<Bool> {
        Binding(get: { model.prefs[keyPath: keyPath] }, set: { model.prefs[keyPath: keyPath] = $0 })
    }

    private func intBinding(_ keyPath: WritableKeyPath<NotificationPreferences, Int>) -> Binding<Int> {
        Binding(get: { model.prefs[keyPath: keyPath] }, set: { model.prefs[keyPath: keyPath] = $0 })
    }

    private func hourBinding(_ keyPath: WritableKeyPath<NotificationPreferences, Int>) -> Binding<Date> {
        Binding(
            get: {
                let hour = model.prefs[keyPath: keyPath]
                return Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
            },
            set: { model.prefs[keyPath: keyPath] = Calendar.current.component(.hour, from: $0) }
        )
    }

    private func toggleFestivalCategory(_ category: FestivalPrimaryCategory) {
        if model.prefs.festival.categories.contains(category) {
            model.prefs.festival.categories.remove(category)
        } else {
            model.prefs.festival.categories.insert(category)
        }
    }

    private func toggleLocalEventCategory(_ category: LocalEventPrimaryCategory) {
        if model.prefs.localEvent.categories.contains(category) {
            model.prefs.localEvent.categories.remove(category)
        } else {
            model.prefs.localEvent.categories.insert(category)
        }
    }

    private func toggleFestivalRegion(_ region: String) {
        if let idx = model.prefs.festival.regions.firstIndex(of: region) {
            model.prefs.festival.regions.remove(at: idx)
        } else {
            model.prefs.festival.regions.append(region)
        }
    }

    private func toggleLocalEventRegion(_ region: String) {
        if let idx = model.prefs.localEvent.regions.firstIndex(of: region) {
            model.prefs.localEvent.regions.remove(at: idx)
        } else {
            model.prefs.localEvent.regions.append(region)
        }
    }

    private func leadDayLabel(_ days: Int) -> String {
        switch days {
        case 0: return "당일"
        case 7: return "1주 전"
        default: return "\(days)일 전"
        }
    }

    // MARK: - 권한 처리

    private func handleDiscoveryToggle(_ enabled: Bool) {
        if enabled {
            Task {
                let granted = await discoveryService.requestAuthorizationIfNeeded()
                permissionDenied = !granted
                discoveryService.scheduleNextRefresh()
            }
        } else {
            discoveryService.scheduleNextRefresh()
        }
    }

    private func refreshPermissionState() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        permissionDenied = settings.authorizationStatus == .denied && model.prefs.anyDiscoveryEnabled
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
