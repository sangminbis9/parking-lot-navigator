import SwiftUI
import UserNotifications

/// 앱 안 알림센터. 알림 하나가 아니라 다가오는 행사 하나가 카드 한 장이다.
struct NotificationsInboxView: View {
    @StateObject private var model: NotificationsInboxViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// 알림 탭으로 들어왔을 때 눈에 띄게 할 카드.
    let focusId: String?
    let onOpenFestival: (Festival) -> Void
    let onOpenEvent: (FreeEvent) -> Void

    @State private var highlightedId: String?
    @State private var permissionDenied = false

    init(
        apiClient: APIClientProtocol,
        focusId: String?,
        onOpenFestival: @escaping (Festival) -> Void,
        onOpenEvent: @escaping (FreeEvent) -> Void
    ) {
        _model = StateObject(wrappedValue: NotificationsInboxViewModel(apiClient: apiClient))
        self.focusId = focusId
        self.onOpenFestival = onOpenFestival
        self.onOpenEvent = onOpenEvent
    }

    var body: some View {
        NavigationStack {
            content
                .background(FestivalDesign.cream.ignoresSafeArea())
                .navigationTitle("알림")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("닫기") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        if model.unreadCount > 0 {
                            Button("모두 읽음") { model.markAllRead() }
                        }
                    }
                }
        }
        .task {
            await model.resolveMissing()
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            permissionDenied = settings.authorizationStatus == .denied
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.rows.isEmpty {
            ScrollView {
                VStack(spacing: 16) {
                    if permissionDenied { permissionBanner }
                    emptyState
                }
                .padding(20)
            }
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if permissionDenied { permissionBanner }
                        Text("다가오는 행사")
                            .font(.festival(size: 15, weight: .bold))
                            .foregroundStyle(FestivalDesign.secondaryText)
                            .padding(.top, 4)
                        ForEach(model.rows) { row in
                            NotificationsInboxCard(row: row, isHighlighted: highlightedId == row.id)
                                .id(row.id)
                                .onTapGesture { open(row) }
                        }
                    }
                    .padding(20)
                }
                .onAppear { focus(with: proxy) }
            }
        }
    }

    private func focus(with proxy: ScrollViewProxy) {
        guard let focusId, model.rows.contains(where: { $0.id == focusId }) else { return }
        withAnimation(.easeInOut(duration: FestivalDesign.Motion.standard)) {
            proxy.scrollTo(focusId, anchor: .center)
            highlightedId = focusId
        }
        // 어디를 보면 되는지 알려 줄 만큼만 남기고 평소 모습으로 돌아간다.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            withAnimation(.easeInOut(duration: FestivalDesign.Motion.standard)) { highlightedId = nil }
        }
    }

    private func open(_ row: NotificationsInboxRow) {
        model.markRead(id: row.id)
        if let festival = row.festival {
            dismiss()
            onOpenFestival(festival)
        } else if let event = row.event {
            dismiss()
            onOpenEvent(event)
        }
        // 상세를 못 받아 온 카드는 읽음 표시만 하고 이동하지 않는다.
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "bell")
                .font(.festival(size: 34, weight: .bold))
                .foregroundStyle(FestivalDesign.coralText)
            Text("아직 새로운 알림이 없어요")
                .font(.festival(size: 17, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
            Text("관심 있는 행사를 저장하거나\n관심 지역을 설정하면\n다가오는 행사를 알려드릴게요.")
                .font(.festival(size: 14))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    private var permissionBanner: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(FestivalDesign.coralText)
            VStack(alignment: .leading, spacing: 4) {
                Text("알림이 꺼져 있어요")
                    .font(.festival(size: 14, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                Text("다가오는 행사 알림을 받으려면 설정에서 알림을 켜주세요.")
                    .font(.festival(size: 13))
                    .foregroundStyle(FestivalDesign.secondaryText)
                Button("설정 열기") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .font(.festival(size: 13, weight: .bold))
                .foregroundStyle(FestivalDesign.coralText)
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius, style: .continuous)
                .fill(FestivalDesign.coral.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius, style: .continuous)
                .stroke(FestivalDesign.coral.opacity(0.4), lineWidth: 1)
        )
    }
}

private struct NotificationsInboxCard: View {
    let row: NotificationsInboxRow
    let isHighlighted: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DiscoverTabThumbnail(imageUrl: row.imageUrl, isFestival: row.item.isFestival, size: 68)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if let dDay = NotificationsInboxFormat.dDay(from: row.startDate) {
                        DiscoverTagChip(text: dDay, tint: FestivalDesign.coral, isLead: true)
                    }
                    Text(row.item.reasonText)
                        .font(.festival(size: 12))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if !row.item.isRead {
                        Circle()
                            .fill(FestivalDesign.coral)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel("읽지 않음")
                    }
                }
                Text(row.title.isEmpty ? "행사" : row.title)
                    .font(.festival(size: 16, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                if row.isUnavailable && !row.canOpenDetail {
                    Text("행사 정보를 더 이상 불러올 수 없습니다.")
                        .font(.festival(size: 13))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    if let dateText = NotificationsInboxFormat.dateText(start: row.startDate, end: row.endDate) {
                        Text(dateText)
                            .font(.festival(size: 13))
                            .foregroundStyle(FestivalDesign.secondaryText)
                    }
                    if let venue = row.venueName, !venue.isEmpty {
                        Text(venue)
                            .font(.festival(size: 13))
                            .foregroundStyle(FestivalDesign.secondaryText)
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .festivalCard(isSelected: isHighlighted)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
