import SwiftUI

struct AgentOfficeView: View {
    @StateObject private var viewModel: AgentOfficeViewModel
    let isActive: Bool

    init(apiClient: APIClientProtocol, isActive: Bool = true) {
        _viewModel = StateObject(wrappedValue: AgentOfficeViewModel(apiClient: apiClient))
        self.isActive = isActive
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                OfficeFloorView(
                    agents: viewModel.agents,
                    snapshot: viewModel.snapshot,
                    activity: viewModel.recentActivity
                )
                    .aspectRatio(1, contentMode: .fit)
                AgentRoleStrip(agents: viewModel.agents)
                if !viewModel.recentActivity.isEmpty {
                    ActivityFeed(events: viewModel.recentActivity)
                }
                summaryCard
                providerSection(title: "주차 제공자", providers: viewModel.snapshot.parkingProviders)
                providerSection(title: "탐색 제공자", providers: viewModel.snapshot.discoveryProviders)
                attribution
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("에이전트 사무실")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: refresh) {
                    Image(systemName: viewModel.isLoading ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                .accessibilityLabel("에이전트 사무실 새로고침")
            }
        }
        .task(id: isActive) {
            guard isActive else { return }
            await viewModel.runPolling()
        }
        .refreshable { await viewModel.refresh() }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("오리온 요약", systemImage: "brain.head.profile")
                    .font(.festival(.headline))
                Spacer()
                Text(viewModel.snapshot.updatedAt, style: .time)
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
            Text(viewModel.snapshot.summary)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.coralText)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func providerSection(title: String, providers: [ProviderHealth]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            if providers.isEmpty {
                Text("아직 제공자 상태가 도착하지 않았어요.")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
            } else {
                ForEach(providers) { provider in
                    ProviderHealthRow(provider: provider)
                }
            }
        }
        .padding(14)
        .festivalCard()
    }

    private var attribution: some View {
        Text("사무실·전체 요원: OpenAI 생성 픽셀 아트")
            .font(.festival(.caption2))
            .foregroundStyle(FestivalDesign.secondaryText.opacity(0.8))
    }
}

private extension AgentOfficeView {
    func refresh() {
        Task { await viewModel.refresh() }
    }
}

// MARK: - Office floor

private struct OfficeFloorView: View {
    let agents: [AgentOfficeAgent]
    let snapshot: AgentOfficeSnapshot
    let activity: [AgentActivityEvent]
    @State private var selectedAgentId: String?
    @State private var showBoardLog = false

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let workingIds = Set(agents.filter { $0.status.isWorkingAtStation }.map(\.id))

            ZStack {
                PixelOfficeBackdrop(activeAgentIds: workingIds)

                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.spring(duration: 0.2)) { selectedAgentId = nil }
                    }

                ForEach(agents) { agent in
                    let frame = StationaryOfficeLayout.frame(for: agent)
                    AgentRunner(
                        agent: agent,
                        frame: frame,
                        spokenLine: liveLine(for: agent.id),
                        onTap: {
                            withAnimation(.spring(duration: 0.2)) {
                                selectedAgentId = selectedAgentId == agent.id ? nil : agent.id
                            }
                        }
                    )
                    .position(x: frame.position.x * size.width,
                              y: frame.position.y * size.height)
                }

                PublishedWall(items: snapshot.published)
                    .frame(width: size.width * 0.44, height: size.height * 0.10)
                    .position(x: size.width * 0.50, y: size.height * 0.945)
                    .onTapGesture { showBoardLog = true }
            }
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                    .stroke(FestivalDesign.creamDeep.opacity(0.6), lineWidth: 1)
            )

            if let sid = selectedAgentId, let sel = agents.first(where: { $0.id == sid }) {
                AgentInfoBadge(
                    agent: sel,
                    recentActivity: activity.filter { $0.agentId == sid }.prefix(5).map { $0 }
                ) {
                    withAnimation(.spring(duration: 0.2)) { selectedAgentId = nil }
                }
                .padding(.top, 8)
                .padding(.trailing, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .transition(.opacity.combined(with: .move(edge: .top)))
                .zIndex(100)
            }
        }
        .sheet(isPresented: $showBoardLog) {
            BoardLogSheet(activity: activity)
        }
    }

    private func liveLine(for agentId: String) -> String? {
        guard let event = activity.first(where: { $0.agentId == agentId }) else { return nil }
        guard isRecentActivity(event.ts) else { return nil }
        return formatActivityLine(event)
    }
}

private func isRecentActivity(_ timestamp: String) -> Bool {
    guard let date = AgentOfficeDateParser.formatter.date(from: timestamp) else {
        return false
    }
    return Date().timeIntervalSince(date) < 120
}

private enum AgentOfficeDateParser {
    static let formatter = ISO8601DateFormatter()
    static let wakeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter
    }()
}

private func formatActivityLine(_ event: AgentActivityEvent) -> String? {
    let title = event.targetTitle ?? ""
    switch (event.agentId, event.action) {
    case ("scout", "found"):
        return title.isEmpty ? "후보 발견" : "발견: \(title)"
    case ("festa", "found"):
        return title.isEmpty ? "축제 후보 발견" : "발견: \(title)"
    case ("orion", "validate"):
        let prefix: String
        switch event.verdict {
        case "approve": prefix = "승인"
        case "reject":  prefix = "거절"
        default:        prefix = "보류"
        }
        if let reason = event.reason, !reason.isEmpty {
            return "\(prefix): \(reason)"
        }
        return title.isEmpty ? prefix : "\(prefix): \(title)"
    case ("orion", "reconsider"):
        let prefix = event.verdict == "approve" ? "복구 승인" : "재검토"
        if let reason = event.reason, !reason.isEmpty {
            return "\(prefix): \(reason)"
        }
        return title.isEmpty ? prefix : "\(prefix): \(title)"
    case ("orion", "error"):
        return "헤드 LLM 오류"
    case ("pixel", "image_enrich"):
        return title.isEmpty ? "대표 사진 보강" : "사진 보강: \(title)"
    case ("pixel", "image_error"):
        return event.reason ?? "사진 보강 오류"
    case ("pixel", "image_skip"):
        return event.reason ?? "사진 후보 없음"
    case ("echo", "post"):
        return title.isEmpty ? "게시판 등록" : "게시: \(title)"
    default:
        return event.reason
    }
}

private struct AgentRoleStrip: View {
    let agents: [AgentOfficeAgent]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("에이전트 담당")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(agents) { agent in
                        AgentRoleCard(agent: agent)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .padding(14)
        .festivalCard()
    }
}

private struct AgentRoleCard: View {
    let agent: AgentOfficeAgent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(agent.status.color.opacity(0.15))
                    AgentPortrait(agent: agent, compact: true)
                }
                .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.name)
                        .font(.festival(.subheadline, weight: .bold))
                        .foregroundStyle(FestivalDesign.navy)
                    Text(agent.role)
                        .font(.festival(.caption, weight: .semibold))
                        .foregroundStyle(FestivalDesign.readable(agent.status.color))
                }
            }
            Text(agent.line)
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: 150, alignment: .leading)
        .padding(10)
        .background(FestivalDesign.cream.opacity(0.34))
        .clipShape(FestivalDesign.controlShape)
        .overlay(
            FestivalDesign.controlShape
                .stroke(agent.status.color.opacity(0.22), lineWidth: 1)
        )
    }
}

private struct ActivityFeed: View {
    let events: [AgentActivityEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("최근 활동")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            ForEach(events.prefix(12)) { event in
                ActivityRow(event: event)
            }
        }
        .padding(14)
        .festivalCard()
    }
}

private struct ActivityRow: View {
    let event: AgentActivityEvent

    private var accent: Color {
        switch event.verdict {
        case "approve": return FestivalDesign.teal
        case "reject":  return FestivalDesign.coral
        case "pending": return FestivalDesign.lantern
        default:
            switch event.agentId {
            case "orion": return FestivalDesign.coral
            case "scout": return FestivalDesign.parkingBlue
            case "festa": return FestivalDesign.lantern
            case "pixel": return Color.purple
            case "echo":  return FestivalDesign.teal
            default:      return FestivalDesign.secondaryText
            }
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(accent).frame(width: 8, height: 8).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(AgentOfficeAgent.displayName(forID: event.agentId))
                        .font(.festival(.caption, weight: .bold))
                        .foregroundStyle(FestivalDesign.readable(accent))
                    Text(event.action)
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    Spacer()
                    Text(shortTime(event.ts))
                        .font(.festival(.caption2))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(formatActivityLine(event) ?? (event.targetTitle ?? "—"))
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
            }
        }
    }

    private func shortTime(_ ts: String) -> String {
        if let date = AgentOfficeDateParser.formatter.date(from: ts) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return ts
    }
}

// MARK: - Choreography

private struct AgentFrame {
    let position: CGPoint
    let direction: PixelSprite.Direction
    let walking: Bool
    let walkPhase: Int
    let stage: Stage
    let carry: CarryKind?

    enum Stage { case idle, walkingOut, reporting, walkingToWall, posting, returning, patrolling, validating, publishing, notifying, dispatching }
    enum CarryKind { case festival, event }
}

/// 비정형 캠퍼스형 사무실의 실제 좌석 중심과 같은 좌표를 사용한다. 좌석은 세 줄의
/// 격자가 아니라 집중석·협업 테이블·라운지·운영석 사이에 엇갈려 배치된다.
/// 데이터가 갱신돼도 요원은 이동하지 않고 각자 맡은 자리에서 상태와 최근 작업만 갱신한다.
private enum StationaryOfficeLayout {
    private static let positions: [String: CGPoint] = [
        // 창가 집중석: 지도 탐색, 총괄 대시보드, 검증 레이더
        "scout": CGPoint(x: 0.215, y: 0.355),
        "orion": CGPoint(x: 0.495, y: 0.355),
        "vera": CGPoint(x: 0.780, y: 0.365),

        // 중앙 협업 섬: 원형 테이블, 크리에이티브 라운지, 스냅샷 콘솔, 게시 운영석
        "festa": CGPoint(x: 0.230, y: 0.550),
        "pixel": CGPoint(x: 0.405, y: 0.595),
        "atlas": CGPoint(x: 0.540, y: 0.520),
        "echo": CGPoint(x: 0.860, y: 0.550),

        // 하단 운영 포드: 주차 관제, 가게 이벤트, 전달 파이프라인
        "sentinel": CGPoint(x: 0.220, y: 0.750),
        "harbor": CGPoint(x: 0.660, y: 0.735),
        "relay": CGPoint(x: 0.890, y: 0.735)
    ]

    static func frame(for agent: AgentOfficeAgent) -> AgentFrame {
        AgentFrame(
            position: positions[agent.id] ?? CGPoint(x: 0.5, y: 0.65),
            direction: .down,
            walking: false,
            walkPhase: 1,
            stage: .idle,
            carry: nil
        )
    }
}

private enum OfficeChoreography {
    // 생성 배경의 중앙 세로 통로(x 0.30...0.70)와 중단 가로 통로(y 0.43...0.72)를
    // 안전 구역으로 삼는다. 모든 경로는 이 영역 안에서만 꺾여 책상·화분을 가로지르지 않는다.
    private static func point(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: CGFloat(x), y: CGFloat(y))
    }

    // 각 홈은 배경의 좌우 워크스테이션 또는 중앙 운영석 앞에 놓인다.
    private static let homes: [String: CGPoint] = [
        "orion":    point(0.50, 0.33),
        "vera":     point(0.16, 0.40),
        "pixel":    point(0.84, 0.40),
        "festa":    point(0.16, 0.52),
        "scout":    point(0.84, 0.52),
        "echo":     point(0.84, 0.66),
        "atlas":    point(0.16, 0.68),
        "relay":    point(0.20, 0.81),
        "harbor":   point(0.80, 0.81),
        "sentinel": point(0.30, 0.70)
    ]

    // 수집 요원은 좌우 책상에서 가로 통로로 나온 뒤 Orion 양옆에 보고한다.
    private static let reportRoutes: [String: [CGPoint]] = [
        "festa": [point(0.16, 0.52), point(0.30, 0.52), point(0.30, 0.39), point(0.44, 0.39)],
        "scout": [point(0.84, 0.52), point(0.70, 0.52), point(0.70, 0.39), point(0.56, 0.39)]
    ]
    // 중앙 통로를 따라 하단 데이터 월 앞까지 이동한다.
    private static let boardRoutes: [String: [CGPoint]] = [
        "festa": [point(0.44, 0.39), point(0.44, 0.84)],
        "scout": [point(0.56, 0.39), point(0.56, 0.84)]
    ]
    private static let homeRoutes: [String: [CGPoint]] = [
        "festa": [point(0.44, 0.84), point(0.44, 0.70), point(0.30, 0.70), point(0.30, 0.52), point(0.16, 0.52)],
        "scout": [point(0.56, 0.84), point(0.56, 0.70), point(0.70, 0.70), point(0.70, 0.52), point(0.84, 0.52)]
    ]

    private static let veraRoute = [point(0.16, 0.40), point(0.30, 0.40), point(0.38, 0.44)]
    private static let pixelRoute = [point(0.84, 0.40), point(0.70, 0.40), point(0.70, 0.66), point(0.62, 0.66)]
    private static let echoRoute = [point(0.84, 0.66), point(0.70, 0.66), point(0.64, 0.76)]
    private static let atlasRoute = [point(0.16, 0.68), point(0.30, 0.68), point(0.30, 0.82), point(0.42, 0.82)]
    private static let harborRoute = [point(0.80, 0.81), point(0.70, 0.81), point(0.70, 0.58), point(0.60, 0.58)]

    // Sentinel은 외곽 운영 통로, Relay는 중앙 Queue 루프를 돈다.
    private static let patrolPath: [CGPoint] = [
        point(0.30, 0.70), point(0.30, 0.43), point(0.70, 0.43),
        point(0.70, 0.70), point(0.56, 0.78), point(0.36, 0.78)
    ]
    private static let relayPath: [CGPoint] = [
        point(0.20, 0.81), point(0.34, 0.81), point(0.34, 0.58),
        point(0.50, 0.58), point(0.50, 0.72), point(0.34, 0.72)
    ]

    static func frame(for agent: AgentOfficeAgent, at t: TimeInterval, snapshot: AgentOfficeSnapshot, hasLiveActivity: Bool) -> AgentFrame {
        let home = homes[agent.id] ?? CGPoint(x: 0.5, y: 0.5)
        guard agent.status.movesInOffice || hasLiveActivity else {
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }

        switch agent.id {
        case "festa":
            return collectorFrame(id: agent.id, t: t, offset: 0,
                                  carry: .festival,
                                  itemCount: snapshot.festivals.count)
        case "scout":
            return collectorFrame(id: agent.id, t: t, offset: 12,
                                  carry: .event,
                                  itemCount: snapshot.events.count)
        case "orion":
            // Mostly working at the PC, glancing over his shoulder now and then.
            let dir: PixelSprite.Direction = (Int(t) % 8 < 5) ? .up : .down
            return AgentFrame(position: home, direction: dir, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case "vera":
            return validatorFrame(t: t)
        case "pixel":
            return imageFrame(t: t, hasMissingImages: snapshot.missingImageCount > 0 || hasLiveActivity)
        case "echo":
            return publisherFrame(t: t, hasItems: snapshot.published.count > 0)
        case "sentinel":
            return patrolFrame(t: t, path: patrolPath)
        case "atlas":
            return serviceFrame(t: t, offset: 2, home: home,
                                route: atlasRoute, active: !snapshot.published.isEmpty,
                                stage: .publishing)
        case "harbor":
            return serviceFrame(t: t, offset: 7, home: home,
                                route: harborRoute,
                                active: snapshot.merchantEventCount > 0 || hasLiveActivity,
                                stage: .notifying)
        case "relay":
            return patrolFrame(t: t + 3, path: relayPath, stage: .dispatching)
        default:
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
    }

    // Position + facing along a waypoint polyline at eased progress.
    private static func walkFrame(route: [CGPoint], progress: Double, t: TimeInterval,
                                  stage: AgentFrame.Stage, carry: AgentFrame.CarryKind?,
                                  phaseRate: Double = 6) -> AgentFrame {
        let p = ease(progress)
        let pos = point(on: route, progress: p)
        let prev = point(on: route, progress: max(0, p - 0.03))
        return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                          walking: true, walkPhase: Int(t * phaseRate) % 3,
                          stage: stage, carry: carry)
    }

    // 24-second cycle: desk(5s) → walk to Orion(4s) → report(4s) → walk to board(4s) → post(2s) → walk home(5s)
    private static func collectorFrame(id: String, t: TimeInterval, offset: Double,
                                       carry: AgentFrame.CarryKind, itemCount: Int) -> AgentFrame {
        let cycle: Double = 24
        let tau = (t + offset).truncatingRemainder(dividingBy: cycle)
        let home = homes[id]!
        let report = reportRoutes[id]!
        let toBoard = boardRoutes[id]!
        let toHome = homeRoutes[id]!

        if itemCount == 0 {
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }

        switch tau {
        case 0..<5:
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case 5..<9:
            return walkFrame(route: report, progress: (tau - 5) / 4, t: t,
                             stage: .walkingOut, carry: carry)
        case 9..<13:
            // Standing beside Orion's chair, facing him.
            let dir: PixelSprite.Direction = id == "festa" ? .right : .left
            return AgentFrame(position: report.last!, direction: dir, walking: false, walkPhase: 1,
                              stage: .reporting, carry: carry)
        case 13..<17:
            return walkFrame(route: toBoard, progress: (tau - 13) / 4, t: t,
                             stage: .walkingToWall, carry: carry)
        case 17..<19:
            // Board stands below the drop point.
            return AgentFrame(position: toBoard.last!, direction: .down, walking: false, walkPhase: 1,
                              stage: .posting, carry: carry)
        default:
            return walkFrame(route: toHome, progress: (tau - 19) / 5, t: t,
                             stage: .returning, carry: nil)
        }
    }

    private static func validatorFrame(t: TimeInterval) -> AgentFrame {
        // Vera paces along the clear row-6 strip beside her desk.
        let cycle: Double = 8
        let tau = t.truncatingRemainder(dividingBy: cycle) / cycle
        let p = (sin(tau * .pi * 2) + 1) / 2
        let pos = point(on: veraRoute, progress: p)
        let prev = point(on: veraRoute, progress: max(0, p - 0.03))
        let walking = p > 0.05 && p < 0.95
        return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                          walking: walking, walkPhase: Int(t * 4) % 3,
                          stage: .validating, carry: nil)
    }

    private static func imageFrame(t: TimeInterval, hasMissingImages: Bool) -> AgentFrame {
        let home = homes["pixel"]!
        guard hasMissingImages else {
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        let cycle: Double = 18
        let tau = t.truncatingRemainder(dividingBy: cycle)
        switch tau {
        case 0..<7:
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .validating, carry: nil)
        case 7..<10:
            return walkFrame(route: pixelRoute, progress: (tau - 7) / 3, t: t,
                             stage: .walkingToWall, carry: nil)
        case 10..<13:
            return AgentFrame(position: pixelRoute.last!, direction: .down, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            return walkFrame(route: Array(pixelRoute.reversed()), progress: (tau - 13) / 5, t: t,
                             stage: .returning, carry: nil)
        }
    }

    private static func publisherFrame(t: TimeInterval, hasItems: Bool) -> AgentFrame {
        let home = homes["echo"]!
        let cycle: Double = 16
        let tau = t.truncatingRemainder(dividingBy: cycle)
        guard hasItems else {
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        switch tau {
        case 0..<10:
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case 10..<12:
            return walkFrame(route: echoRoute, progress: (tau - 10) / 2, t: t,
                             stage: .walkingToWall, carry: nil)
        case 12..<14:
            return AgentFrame(position: echoRoute.last!, direction: .down, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            return walkFrame(route: Array(echoRoute.reversed()), progress: (tau - 14) / 2, t: t,
                             stage: .returning, carry: nil)
        }
    }

    private static func serviceFrame(t: TimeInterval, offset: Double, home: CGPoint,
                                     route: [CGPoint], active: Bool,
                                     stage: AgentFrame.Stage) -> AgentFrame {
        guard active else {
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        let cycle: Double = 18
        let tau = (t + offset).truncatingRemainder(dividingBy: cycle)
        switch tau {
        case 0..<6:
            return AgentFrame(position: home, direction: .up, walking: false, walkPhase: 1,
                              stage: stage, carry: nil)
        case 6..<10:
            return walkFrame(route: route, progress: (tau - 6) / 4, t: t,
                             stage: stage, carry: nil)
        case 10..<13:
            return AgentFrame(position: route.last ?? home, direction: .down,
                              walking: false, walkPhase: 1, stage: stage, carry: nil)
        default:
            return walkFrame(route: Array(route.reversed()), progress: (tau - 13) / 5,
                             t: t, stage: .returning, carry: nil)
        }
    }

    private static func patrolFrame(t: TimeInterval, path: [CGPoint],
                                    stage: AgentFrame.Stage = .patrolling) -> AgentFrame {
        let segDuration: Double = 6
        let total = Double(path.count) * segDuration
        let tau = t.truncatingRemainder(dividingBy: total)
        let segIndex = Int(tau / segDuration)
        let local = (tau - Double(segIndex) * segDuration) / segDuration
        let from = path[segIndex]
        let to = path[(segIndex + 1) % path.count]
        let pos = lerp(from, to, ease(local))
        let walking3 = Int(t * 6) % 3
        let dx = to.x - from.x
        let dy = to.y - from.y
        let dir: PixelSprite.Direction
        if abs(dx) > abs(dy) {
            dir = dx >= 0 ? .right : .left
        } else {
            dir = dy >= 0 ? .down : .up
        }
        return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                          stage: stage, carry: nil)
    }

    static func spokenLine(for agent: AgentOfficeAgent, frame: AgentFrame,
                           snapshot: AgentOfficeSnapshot) -> String? {
        if agent.status == .idle {
            return nextWakeLine(for: agent.id, at: Date())
        }
        guard agent.status.canSpeakInOffice else { return nil }
        switch agent.id {
        case "festa":
            return collectorLine(stage: frame.stage, items: snapshot.festivals, fallback: agent.line)
        case "scout":
            return collectorLine(stage: frame.stage, items: snapshot.events, fallback: agent.line)
        case "orion":
            // Show approval when a collector is reporting nearby
            let reporterActive = snapshot.festivals.count > 0 || snapshot.events.count > 0
            if reporterActive, Int(Date().timeIntervalSince1970) % 8 < 3 {
                return "확인했어요. 게시판에 올려요."
            }
            return nil
        case "vera":
            switch frame.stage {
            case .validating: return agent.line
            default: return nil
            }
        case "pixel":
            switch frame.stage {
            case .validating: return agent.line
            case .posting: return "대표 사진을 붙였어요."
            default: return nil
            }
        case "echo":
            switch frame.stage {
            case .posting: return "푸시 일정 잡아둘게요."
            default: return nil
            }
        case "sentinel":
            // Speak only at corners
            let segDuration: Double = 6
            let total = Double(6) * segDuration
            let tau = Date().timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: total)
            let local = tau - Double(Int(tau / segDuration)) * segDuration
            return local < 1.0 ? agent.line : nil
        case "atlas":
            return frame.stage == .publishing ? agent.reply : nil
        case "harbor":
            return frame.stage == .notifying ? agent.reply : nil
        case "relay":
            let local = Date().timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 12)
            return local < 1.0 ? agent.reply : nil
        default:
            return nil
        }
    }

    private static func collectorLine(stage: AgentFrame.Stage, items: [DiscoveryItem], fallback: String) -> String? {
        guard !items.isEmpty else { return nil }
        let pickIndex = Int(Date().timeIntervalSince1970 / 24) % items.count
        let title = items[pickIndex].title
        switch stage {
        case .walkingOut, .walkingToWall:
            return "「\(title)」"
        case .reporting:
            return "총괄님, \(title) 찾았어요!"
        case .posting:
            return "게시판에 붙입니다."
        default:
            return nil
        }
    }

    private static func nextWakeLine(for agentId: String, at date: Date) -> String? {
        guard let wakeDate = nextWakeDate(for: agentId, after: date) else { return nil }
        return "다음 \(formatWakeTime(wakeDate))에 깨어나요."
    }

    private static func nextWakeDate(for agentId: String, after date: Date) -> Date? {
        switch agentId {
        case "festa":
            return nextMinuteSlot(after: date, intervalMinutes: 9)
        case "scout":
            return nextHourlyMinute(after: date, minute: 15)
        case "orion", "pixel", "echo":
            return nextThreeHourSlot(after: date, minute: 30)
        case "atlas":
            return nextMinuteOffset(after: date, intervalMinutes: 5, offset: 2)
        case "relay":
            return nextMinuteSlot(after: date, intervalMinutes: 1)
        case "harbor":
            return nil // 이벤트 등록 직후 실행되는 event-driven 요원
        case "vera", "sentinel":
            return nextMinuteSlot(after: date, intervalMinutes: 1)
        default:
            return nil
        }
    }

    private static func nextMinuteSlot(after date: Date, intervalMinutes: Int) -> Date? {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard let minute = components.minute else { return nil }
        let nextMinute = ((minute / intervalMinutes) + 1) * intervalMinutes
        if nextMinute < 60 {
            var nextComponents = components
            nextComponents.minute = nextMinute
            nextComponents.second = 0
            return calendar.date(from: nextComponents)
        }
        guard let nextHour = calendar.date(byAdding: .hour, value: 1, to: date) else { return nil }
        var nextComponents = calendar.dateComponents([.year, .month, .day, .hour], from: nextHour)
        nextComponents.minute = 0
        nextComponents.second = 0
        return calendar.date(from: nextComponents)
    }

    private static func nextMinuteOffset(after date: Date, intervalMinutes: Int,
                                         offset: Int) -> Date? {
        let calendar = Calendar.current
        var base = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        base.second = 0
        guard let start = calendar.date(from: base) else { return nil }
        let normalizedOffset = ((offset % intervalMinutes) + intervalMinutes) % intervalMinutes
        for delta in 0...intervalMinutes {
            guard let candidate = calendar.date(byAdding: .minute, value: delta, to: start),
                  candidate > date else { continue }
            if calendar.component(.minute, from: candidate) % intervalMinutes == normalizedOffset {
                return candidate
            }
        }
        return nil
    }

    private static func nextHourlyMinute(after date: Date, minute: Int) -> Date? {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        components.minute = minute
        components.second = 0
        guard let candidate = calendar.date(from: components) else { return nil }
        if candidate > date { return candidate }
        return calendar.date(byAdding: .hour, value: 1, to: candidate)
    }

    private static func nextThreeHourSlot(after date: Date, minute: Int) -> Date? {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        guard let hour = components.hour else { return nil }
        for offset in 0...4 {
            let candidateHour = ((hour / 3) * 3) + (offset * 3)
            var nextComponents = components
            nextComponents.hour = candidateHour % 24
            nextComponents.minute = minute
            nextComponents.second = 0
            guard var candidate = calendar.date(from: nextComponents) else { continue }
            if candidateHour >= 24 {
                candidate = calendar.date(byAdding: .day, value: candidateHour / 24, to: candidate) ?? candidate
            }
            if candidate > date { return candidate }
        }
        return nil
    }

    private static func formatWakeTime(_ date: Date) -> String {
        AgentOfficeDateParser.wakeFormatter.string(from: date)
    }

    private static func ease(_ x: Double) -> Double {
        let c = max(0, min(1, x))
        return c < 0.5 ? 2 * c * c : 1 - pow(-2 * c + 2, 2) / 2
    }

    private static func point(on points: [CGPoint], progress: Double) -> CGPoint {
        guard points.count > 1 else { return points.first ?? .zero }
        let lengths = zip(points, points.dropFirst()).map { distance($0, $1) }
        let total = lengths.reduce(0, +)
        guard total > 0 else { return points.last ?? .zero }

        var remaining = CGFloat(max(0, min(1, progress))) * total
        for index in lengths.indices {
            let length = lengths[index]
            if remaining <= length {
                let local = Double(remaining / length)
                return lerp(points[index], points[index + 1], local)
            }
            remaining -= length
        }
        return points.last ?? .zero
    }

    private static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(b.x - a.x, b.y - a.y)
    }

    private static func direction(from a: CGPoint, to b: CGPoint) -> PixelSprite.Direction {
        let dx = b.x - a.x
        let dy = b.y - a.y
        if abs(dx) > abs(dy) {
            return dx >= 0 ? .right : .left
        }
        return dy >= 0 ? .down : .up
    }

    private static func lerp(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * CGFloat(t),
                y: a.y + (b.y - a.y) * CGFloat(t))
    }
}

private extension AgentOfficeStatus {
    var isWorkingAtStation: Bool {
        switch self {
        case .thinking, .collecting, .validating, .monitoring:
            return true
        case .idle, .blocked, .error:
            return false
        }
    }

    var movesInOffice: Bool {
        switch self {
        case .thinking, .collecting, .validating, .monitoring:
            return true
        case .idle, .blocked, .error:
            return false
        }
    }

    var canSpeakInOffice: Bool {
        switch self {
        case .idle:
            return false
        case .thinking, .collecting, .validating, .monitoring, .blocked, .error:
            return true
        }
    }
}

// MARK: - Agent runner (sprite + name + carry + bubble)

private struct AgentRunner: View {
    let agent: AgentOfficeAgent
    let frame: AgentFrame
    let spokenLine: String?
    var onTap: (() -> Void)? = nil

    var body: some View {
        ZStack {
            // Shadow
            Ellipse()
                .fill(FestivalDesign.navy.opacity(0.18))
                .frame(width: 24, height: 6)
                .offset(y: 24)

            AgentPortrait(agent: agent, compact: false)

            if let carry = frame.carry {
                CarryMarker(kind: carry)
                    .offset(x: 10, y: -16)
            }

            if let line = spokenLine {
                PixelBubble(text: line, speaker: agent.name, accent: agent.status.color)
                    .offset(x: bubbleXOffset, y: -44)
            }

            Text(agent.name)
                .font(.festival(size: 8, weight: .semibold))
                .padding(.horizontal, 3)
                .padding(.vertical, 1)
                .background(FestivalDesign.surface.opacity(0.9))
                .clipShape(FestivalDesign.chipShape)
                .offset(y: 32)
                .foregroundStyle(FestivalDesign.navy)
        }
        .frame(width: 72, height: 82)
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role)\(spokenLine.map { ", \($0)" } ?? "")")
    }

    private var bubbleXOffset: CGFloat {
        switch agent.id {
        case "orion", "sentinel": return 38
        case "pixel", "relay": return -38
        default: return 0
        }
    }
}

/// 모든 요원이 같은 원본 시트와 동일한 픽셀 밀도를 사용한다.
private struct AgentPortrait: View {
    let agent: AgentOfficeAgent
    let compact: Bool

    var body: some View {
        TeamSheetPortrait(index: agent.teamPortraitIndex)
            .frame(width: compact ? 38 : 58, height: compact ? 38 : 58)
    }
}

private struct TeamSheetPortrait: View {
    let index: Int

    var body: some View {
        GeometryReader { proxy in
            Image("AgentOfficeTeamSheet")
                .resizable()
                .interpolation(.none)
                .frame(width: proxy.size.width * 5, height: proxy.size.height * 2)
                .offset(
                    x: -CGFloat(index % 5) * proxy.size.width,
                    y: -CGFloat(index / 5) * proxy.size.height
                )
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

private extension AgentOfficeAgent {
    var teamPortraitIndex: Int {
        switch id {
        case "orion": return 0
        case "festa": return 1
        case "scout": return 2
        case "vera": return 3
        case "pixel": return 4
        case "sentinel": return 5
        case "echo": return 6
        case "atlas": return 7
        case "harbor": return 8
        case "relay": return 9
        default: return 0
        }
    }
}

// Pixel-style info badge: agent status + recent 5 activities with timestamps.
private struct AgentInfoBadge: View {
    let agent: AgentOfficeAgent
    var recentActivity: [AgentActivityEvent] = []
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(agent.status.color)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Rectangle()
                        .fill(agent.status.color)
                        .frame(width: 5, height: 5)
                    Text(agent.status.title)
                        .font(.festival(size: 8, weight: .bold))
                        .foregroundStyle(FestivalDesign.readable(agent.status.color))
                    Spacer()
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.festival(size: 8, weight: .bold))
                            .foregroundStyle(FestivalDesign.navy.opacity(0.5))
                            .frame(width: 22, height: 22)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("말풍선 닫기")
                }
                Text(agent.name)
                    .font(.festival(size: 12, weight: .heavy))
                    .foregroundStyle(FestivalDesign.navy)
                Text(agent.role)
                    .font(.festival(size: 8))
                    .foregroundStyle(FestivalDesign.navy.opacity(0.65))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                if !recentActivity.isEmpty {
                    Rectangle()
                        .fill(FestivalDesign.navy.opacity(0.15))
                        .frame(height: 1)
                        .padding(.top, 2)
                    ForEach(recentActivity.indices, id: \.self) { i in
                        let ev = recentActivity[i]
                        HStack(alignment: .top, spacing: 4) {
                            Text(shortTime(ev.ts))
                                .font(.festival(size: 7))
                                .foregroundStyle(FestivalDesign.secondaryText)
                                .frame(width: 32, alignment: .leading)
                            Text(formatActivityLine(ev) ?? ev.action)
                                .font(.festival(size: 8))
                                .foregroundStyle(FestivalDesign.navy)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .frame(width: 190)
        .background(FestivalDesign.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(agent.status.color.opacity(0.45), lineWidth: 1.5))
        .festivalShadow(.medium)
    }

    private func shortTime(_ ts: String) -> String {
        guard let date = AgentOfficeDateParser.formatter.date(from: ts) else { return "--:--" }
        return AgentOfficeDateParser.wakeFormatter.string(from: date)
    }
}

private struct CarryMarker: View {
    let kind: AgentFrame.CarryKind

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 12, height: 12)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(FestivalDesign.navy.opacity(0.6), lineWidth: 1)
                )
            Text(symbol)
                .font(.festival(size: 8))
        }
    }

    private var color: Color {
        switch kind {
        case .festival: return FestivalDesign.lantern.opacity(0.9)
        case .event: return FestivalDesign.parkingBlue.opacity(0.85)
        }
    }

    private var symbol: String {
        switch kind {
        case .festival: return "🎪"
        case .event: return "🎟"
        }
    }
}

private struct PixelBubble: View {
    let text: String
    let speaker: String
    let accent: Color

    var body: some View {
        VStack(spacing: 1) {
            Text(speaker)
                .font(.festival(size: 7, weight: .heavy))
                .tracking(0.4)
                .foregroundStyle(FestivalDesign.readable(accent))
            Text(text)
                .font(.festival(size: 9))
                .foregroundStyle(FestivalDesign.navy)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .frame(maxWidth: 130)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(FestivalDesign.surface)
                Triangle()
                    .fill(FestivalDesign.surface)
                    .frame(width: 6, height: 4)
                    .offset(y: 18)
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(accent.opacity(0.55), lineWidth: 1)
        )
        // navy는 다크에서 밝은 본문색이 되므로, 그림자는 검정으로 고정한다.
        .shadow(color: Color.black.opacity(0.10), radius: 3, y: 1)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Pixel backdrop (PNG sprite scene)

// MARK: - PixelOfficeBackdrop (pixel-agents tileset)
//
// Tile grid: 21 cols × 22 rows. Wall band rows 0–2, floor rows 3–21.
// Furniture sprites are anchored top-left at (col, row) tiles.
// Character choreography uses normalized (0..1) coords on the SAME geometry.

private enum OfficeLayout {
    static let cols = 21
    static let rows = 22
    static let wallBandRows = 2  // top rows that show the wall (2 keeps more floor visible)

    struct Furn {
        let id: String       // imageset suffix (without PA- prefix)
        let col: Int
        let row: Int         // top-left grid row (sprite extends down by h tiles)
        let w: Int           // sprite width in tiles
        let h: Int           // sprite height in tiles
        let flipH: Bool      // mirror horizontally
        init(_ id: String, col: Int, row: Int, w: Int, h: Int, flipH: Bool = false) {
            self.id = id; self.col = col; self.row = row
            self.w = w; self.h = h; self.flipH = flipH
        }
    }

    // Wall-mounted decor (anchored within rows 0–2)
    static let wallDecor: [Furn] = [
        Furn("BOOKSHELF",       col: 1,  row: 1, w: 2, h: 1),
        Furn("LARGE_PAINTING",  col: 4,  row: 0, w: 2, h: 2),
        Furn("CLOCK",           col: 7,  row: 0, w: 1, h: 2),
        Furn("WHITEBOARD",      col: 9,  row: 0, w: 2, h: 2),
        Furn("SMALL_PAINTING",  col: 12, row: 0, w: 1, h: 2),
        Furn("LARGE_PAINTING",  col: 14, row: 0, w: 2, h: 2),
        Furn("SMALL_PAINTING_2",col: 17, row: 0, w: 1, h: 2),
        Furn("BOOKSHELF",       col: 18, row: 1, w: 2, h: 1),
    ]

    // Hanging plants (pinned at wall/floor seam, wallBandRows=2 → row 2)
    static let hangings: [Furn] = [
        Furn("HANGING_PLANT", col: 0,  row: 2, w: 1, h: 2),
        Furn("HANGING_PLANT", col: 20, row: 2, w: 1, h: 2),
    ]

    // Top desk row: vera/pixel shifted 1 up (req 7); orion shifted 2 up (req 7, stays in place per req 6)
    static let topDesks: [Furn] = [
        // vera ~ col 1–3, row 4–5
        Furn("DESK_FRONT",         col: 1,  row: 4, w: 3, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 2,  row: 6, w: 1, h: 2),
        // orion ~ col 9–11, row 3–4 (2 rows higher as boss anchor), flanked by plants
        Furn("PLANT_2",            col: 8,  row: 3, w: 1, h: 2),
        Furn("DESK_FRONT",         col: 9,  row: 3, w: 3, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 10, row: 5, w: 1, h: 2),
        Furn("PLANT_2",            col: 12, row: 3, w: 1, h: 2),
        // pixel ~ col 17–19, row 4–5
        Furn("DESK_FRONT",         col: 17, row: 4, w: 3, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 18, row: 6, w: 1, h: 2),
    ]

    // Mid-room: festa (left) and scout (right) — each shifted 1 row up (req 6 +1 down, req 7 +2 up = net 1 up)
    static let midDesks: [Furn] = [
        Furn("DESK_FRONT",         col: 1,  row: 11, w: 3, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 2,  row: 13, w: 1, h: 2),
        Furn("DESK_FRONT",         col: 17, row: 11, w: 3, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 18, row: 13, w: 1, h: 2),
    ]

    // Desk PCs, drawn separately so the screen lights up while its agent works.
    struct DeskPC {
        let agentId: String
        let col: Int
        let row: Int
    }

    static let deskPCs: [DeskPC] = [
        DeskPC(agentId: "vera",  col: 2,  row: 4),
        DeskPC(agentId: "orion", col: 10, row: 3),
        DeskPC(agentId: "pixel", col: 18, row: 4),
        DeskPC(agentId: "festa", col: 2,  row: 11),
        DeskPC(agentId: "scout", col: 18, row: 11),
        DeskPC(agentId: "echo",  col: 18, row: 15),
    ]

    // Rug under the meeting nook (tinted checker floor tiles)
    static let rugCols = 2..<6
    static let rugRows = 16..<19

    // Corridor (row 9–10): only flanking accent plants — centre kept clear for agent paths
    static let corridor: [Furn] = [
        Furn("PLANT",  col: 4,  row: 9, w: 1, h: 2),   // just right of vera cluster
        Furn("CACTUS", col: 16, row: 9, w: 1, h: 2),   // just left of pixel cluster
    ]

    // Meeting nook: U-shape sofa (SOFA_FRONT = cushions face south toward table), table inside pocket
    // Layout row 16: [SL][SF][SF][SR]   row 17: [SL][CT][CT][SR]   row 18: [  ][CT+☕][CT][  ]
    static let meetingNook: [Furn] = [
        Furn("SOFA_SIDE",   col: 2, row: 16, w: 1, h: 2),
        Furn("SOFA_FRONT",  col: 3, row: 16, w: 2, h: 1),  // cushions face player (south)
        Furn("SOFA_SIDE",   col: 5, row: 16, w: 1, h: 2, flipH: true),
        Furn("COFFEE_TABLE",col: 3, row: 17, w: 2, h: 2),
        Furn("COFFEE",      col: 4, row: 18, w: 1, h: 1),  // centre-right of table surface
    ]

    // Echo desk on the right + corner plants (bottom-center stays clear for PublishedWall)
    static let amenities: [Furn] = [
        // echo desk (right cluster, matches echo home col 18.5 row 17.5)
        Furn("DESK_FRONT",         col: 17, row: 15, w: 3, h: 2),
        Furn("WOODEN_CHAIR_BACK",  col: 18, row: 17, w: 1, h: 2),
        // corner plants (outside the sofa/echo zone, not overlapping any desk)
        Furn("LARGE_PLANT", col: 0,  row: 14, w: 2, h: 3),  // left corner
        Furn("LARGE_PLANT", col: 19, row: 18, w: 2, h: 3),  // right corner beside echo
        // misc — kept clear of the notice board zone (cols ~5.5–15.5)
        Furn("BIN", col: 4,  row: 20, w: 1, h: 1),
        Furn("POT", col: 16, row: 20, w: 1, h: 1),
    ]

    static var allFurniture: [Furn] {
        wallDecor + hangings + topDesks + corridor + midDesks + meetingNook + amenities
    }
}

private struct PixelOfficeBackdrop: View {
    var activeAgentIds: Set<String> = []

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            Image("AgentOfficeHighRiseBackground")
                .resizable()
                .interpolation(.none)
                .scaledToFill()
                .frame(width: w, height: h)
                .clipped()

            LinearGradient(
                colors: [Color.black.opacity(0.02), Color.clear, FestivalDesign.navy.opacity(0.08)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            HStack(spacing: 4) {
                Rectangle()
                    .fill(FestivalDesign.teal)
                    .frame(width: 6, height: 6)
                Text("LIVE · \(activeAgentIds.count)명")
                    .font(.festival(size: 9, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(FestivalDesign.surface)
            .overlay(Rectangle().stroke(FestivalDesign.navy.opacity(0.7), lineWidth: 1))
            .position(x: w - 58, y: 18)
        }
    }
}

private struct PixelTile: View {
    let name: String
    let widthTiles: Int
    let heightTiles: Int
    let tile: CGFloat
    let flipH: Bool
    var body: some View {
        Image(name)
            .resizable()
            .interpolation(.none)
            .frame(width: tile * CGFloat(widthTiles),
                   height: tile * CGFloat(heightTiles))
            .scaleEffect(x: flipH ? -1 : 1, y: 1, anchor: .center)
    }
}

// Floor: wall band on rows 0..wallBandRows-1 (cream wallpaper),
// warm-tinted floor below using PA-floor_1 tiled per cell, plus a rug in the nook.
private struct FloorTileGrid: View {
    let tile: CGFloat

    private static let floorTint = Color(red: 1.0, green: 0.91, blue: 0.78)
    private static let rugTint = Color(red: 0.95, green: 0.62, blue: 0.55)

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Floor base fills entire frame — no gaps show between tiles
            Color(red: 0.87, green: 0.73, blue: 0.53)
            // Floor tiles (PA-floor_1) tiled per cell, warmed so the room isn't flat gray
            ForEach(OfficeLayout.wallBandRows..<OfficeLayout.rows, id: \.self) { r in
                ForEach(0..<OfficeLayout.cols, id: \.self) { c in
                    Image("PA-floor_1")
                        .resizable()
                        .interpolation(.none)
                        .colorMultiply(Self.floorTint)
                        .frame(width: tile, height: tile)
                        .offset(x: CGFloat(c) * tile, y: CGFloat(r) * tile)
                }
            }
            // Meeting-nook rug: coral checker tiles under the sofa set
            ForEach(OfficeLayout.rugRows, id: \.self) { r in
                ForEach(OfficeLayout.rugCols, id: \.self) { c in
                    Image("PA-floor_7")
                        .resizable()
                        .interpolation(.none)
                        .colorMultiply(Self.rugTint)
                        .frame(width: tile, height: tile)
                        .offset(x: CGFloat(c) * tile, y: CGFloat(r) * tile)
                }
            }
            // Wall band painted last so it always covers the top rows cleanly
            Rectangle()
                .fill(Color(red: 0.96, green: 0.91, blue: 0.78))
                .frame(width: tile * CGFloat(OfficeLayout.cols),
                       height: tile * CGFloat(OfficeLayout.wallBandRows))
        }
    }
}

// Dark band at the wall/floor seam (baseboard shadow)
private struct FloorShadowBaseboard: View {
    let tile: CGFloat
    var body: some View {
        Rectangle()
            .fill(Color(red: 0.18, green: 0.13, blue: 0.10).opacity(0.35))
            .frame(height: max(2, tile * 0.18))
    }
}

// MARK: - Board log sheet (shown when user taps the PublishedWall cork board)
// Renders the same ActivityFeed + ActivityRow style as the main office tab's activity section.

private struct BoardLogSheet: View {
    let activity: [AgentActivityEvent]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                if activity.isEmpty {
                    Text("아직 활동이 없어요.")
                        .font(.festival(.subheadline))
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(40)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("최근 활동")
                            .font(.festival(.headline))
                            .foregroundStyle(FestivalDesign.navy)
                        ForEach(Array(activity.prefix(20))) { event in
                            ActivityRow(event: event)
                        }
                    }
                    .padding(14)
                    .festivalCard()
                    .padding(16)
                }
            }
            .background(FestivalDesign.background.ignoresSafeArea())
            .navigationTitle("에이전트 활동 로그")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Published wall

// Standing pixel cork board: wooden frame + legs, title plaque, pinned sticky notes.
private struct PublishedWall: View {
    let items: [DiscoveryItem]

    private static let frameDark = Color(red: 0.36, green: 0.22, blue: 0.11)
    private static let frameLight = Color(red: 0.65, green: 0.44, blue: 0.24)
    private static let cork = Color(red: 0.83, green: 0.62, blue: 0.38)
    private static let noteColors: [Color] = [
        Color(red: 1.00, green: 0.92, blue: 0.60),  // sticky yellow
        Color(red: 0.73, green: 0.89, blue: 0.97),  // sky
        Color(red: 1.00, green: 0.81, blue: 0.83),  // pink
        Color(red: 0.80, green: 0.94, blue: 0.74),  // mint
        Color(red: 0.93, green: 0.84, blue: 0.98),  // lilac
    ]
    private static let noteTilts: [Double] = [-2.5, 1.8, -1.2, 2.4, -1.8]

    var body: some View {
        VStack(spacing: 0) {
            board
            legs
        }
    }

    private var board: some View {
        ZStack {
            Rectangle()
                .fill(Self.cork)
                .overlay(PixelBoardDots().opacity(0.32))
            Rectangle()
                .strokeBorder(Self.frameLight, lineWidth: 5)
            Rectangle()
                .strokeBorder(Self.frameDark, lineWidth: 2)
            Rectangle()
                .strokeBorder(Self.frameDark.opacity(0.55), lineWidth: 1)
                .padding(5)

            if items.isEmpty {
                Text("오늘의 소식을 준비 중이에요")
                    .font(.festival(size: 8))
                    .foregroundStyle(Self.frameDark.opacity(0.85))
            } else {
                HStack(alignment: .center, spacing: 5) {
                    ForEach(Array(items.prefix(5).enumerated()), id: \.element.id) { index, item in
                        StickyNote(
                            item: item,
                            color: Self.noteColors[index % Self.noteColors.count],
                            tilt: Self.noteTilts[index % Self.noteTilts.count]
                        )
                    }
                }
                .padding(.horizontal, 10)
                .padding(.top, 12)
                .padding(.bottom, 8)
            }
        }
        .overlay(alignment: .topTrailing) {
            if !items.isEmpty {
                Text("\(items.count)건")
                    .font(.festival(size: 7, weight: .bold))
                    .foregroundStyle(Color(red: 0.99, green: 0.95, blue: 0.86))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Self.frameDark)
                    .padding(6)
            }
        }
        .overlay(alignment: .top) { plaque }
    }

    // Navy name plate that overlaps the top frame edge.
    private var plaque: some View {
        HStack(spacing: 4) {
            Rectangle().fill(FestivalDesign.coral).frame(width: 4, height: 4)
            Text("게시판")
                .font(.festival(size: 9, weight: .heavy))
                .tracking(1)
                .foregroundStyle(Color(red: 0.99, green: 0.95, blue: 0.86))
            Rectangle().fill(FestivalDesign.coral).frame(width: 4, height: 4)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(FestivalDesign.navy)
        .overlay(Rectangle().stroke(Self.frameDark, lineWidth: 1.5))
        .offset(y: -6)
    }

    private var legs: some View {
        HStack {
            legPost
            Spacer()
            legPost
        }
        .padding(.horizontal, 16)
        .frame(height: 7)
    }

    private var legPost: some View {
        Rectangle()
            .fill(Self.frameDark)
            .overlay(Rectangle().fill(Self.frameLight).frame(width: 2), alignment: .leading)
            .frame(width: 7)
    }
}

// One pinned sticky note on the cork board.
private struct StickyNote: View {
    let item: DiscoveryItem
    let color: Color
    let tilt: Double

    var body: some View {
        VStack(spacing: 1) {
            Text(symbol)
                .font(.festival(size: 10))
            Text(item.title)
                .font(.festival(size: 7, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 2)
        .padding(.top, 4)
        .padding(.bottom, 3)
        .frame(maxWidth: .infinity, minHeight: 32)
        .background(
            ZStack {
                // Hard pixel drop shadow
                Rectangle()
                    .fill(Color.black.opacity(0.22))
                    .offset(x: 1.5, y: 2)
                Rectangle()
                    .fill(color)
            }
        )
        .overlay(Rectangle().stroke(FestivalDesign.navy.opacity(0.3), lineWidth: 1))
        .overlay(alignment: .top) {
            Circle()
                .fill(FestivalDesign.coral)
                .overlay(Circle().stroke(Color(red: 0.55, green: 0.12, blue: 0.12), lineWidth: 1))
                .frame(width: 5, height: 5)
                .offset(y: -2)
        }
        .rotationEffect(.degrees(tilt))
    }

    private var symbol: String {
        switch item.kind {
        case .festival: return "🎪"
        case .event: return "🎟"
        }
    }
}

private struct PixelBoardDots: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 8
            let dot = Color(red: 0.40, green: 0.23, blue: 0.12)
            var y: CGFloat = 4
            while y < size.height {
                var x: CGFloat = 4
                while x < size.width {
                    let rect = CGRect(x: x, y: y, width: 2, height: 2)
                    context.fill(Path(rect), with: .color(dot))
                    x += step
                }
                y += step
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// MARK: - Provider row

private struct ProviderHealthRow: View {
    let provider: ProviderHealth

    private var color: Color {
        if provider.stale { return FestivalDesign.coral }
        switch provider.status.lowercased() {
        case "up": return FestivalDesign.teal
        case "degraded": return FestivalDesign.lantern
        case "down", "stale": return FestivalDesign.coral
        default: return FestivalDesign.secondaryText
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                    .font(.festival(.subheadline, weight: .bold))
                    .foregroundStyle(FestivalDesign.navy)
                Text(provider.lastError ?? "품질 \(Int(provider.qualityScore * 100))%")
                    .font(.festival(.caption))
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
            Text(providerStatusText)
                .font(.festival(.caption, weight: .bold))
                .foregroundStyle(FestivalDesign.readable(color))
        }
        .padding(.vertical, 6)
    }

    private var providerStatusText: String {
        if provider.stale { return "지연" }
        switch provider.status.lowercased() {
        case "up": return "정상"
        case "degraded": return "주의"
        case "down": return "중단"
        case "stale": return "지연"
        default: return provider.status
        }
    }
}

#Preview {
    NavigationStack {
        AgentOfficeView(apiClient: MockAPIClient())
    }
}
