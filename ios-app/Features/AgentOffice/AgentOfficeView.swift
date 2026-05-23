import SwiftUI

struct AgentOfficeView: View {
    @StateObject private var viewModel: AgentOfficeViewModel

    init(apiClient: APIClientProtocol) {
        _viewModel = StateObject(wrappedValue: AgentOfficeViewModel(apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                OfficeFloorView(
                    agents: viewModel.agents,
                    snapshot: viewModel.snapshot,
                    activity: viewModel.recentActivity
                )
                    .aspectRatio(0.78, contentMode: .fit)
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
        .navigationTitle("에이전트 사무실")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: refresh) {
                    Image(systemName: viewModel.isLoading ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                .accessibilityLabel("에이전트 사무실 새로고침")
            }
        }
        .task { await viewModel.runPolling() }
        .refreshable { await viewModel.refresh() }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("오리온 요약", systemImage: "brain.head.profile")
                    .font(.headline)
                Spacer()
                Text(viewModel.snapshot.updatedAt, style: .time)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
            Text(viewModel.snapshot.summary)
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.navy)
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.coral)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func providerSection(title: String, providers: [ProviderHealth]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            if providers.isEmpty {
                Text("아직 제공자 상태가 도착하지 않았어요.")
                    .font(.subheadline)
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
        Text("픽셀 스프라이트: harishkotra/agent-office (MIT)")
            .font(.caption2)
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

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24.0, paused: false)) { timeline in
            GeometryReader { proxy in
                let size = proxy.size
                let t = timeline.date.timeIntervalSinceReferenceDate

                ZStack {
                    PixelOfficeBackdrop()
                    PublishedWall(items: snapshot.published)
                        .frame(width: size.width * 0.88, height: size.height * 0.20)
                        .position(x: size.width * 0.50, y: size.height * 0.88)

                    ForEach(agents) { agent in
                        let live = liveLine(for: agent.id)
                        let frame = OfficeChoreography.frame(
                            for: agent,
                            at: t,
                            snapshot: snapshot,
                            hasLiveActivity: live != nil
                        )
                        let line = live
                            ?? OfficeChoreography.spokenLine(for: agent, frame: frame, snapshot: snapshot)
                        AgentRunner(
                            agent: agent,
                            frame: frame,
                            spokenLine: line
                        )
                        .position(x: frame.position.x * size.width,
                                  y: frame.position.y * size.height)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                        .stroke(FestivalDesign.creamDeep.opacity(0.6), lineWidth: 1)
                )
            }
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
                .font(.headline)
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
                    PixelSprite(
                        sheet: agent.spriteAsset,
                        direction: .down,
                        walking: false,
                        walkPhase: 1,
                        scale: 1.05
                    )
                }
                .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(FestivalDesign.navy)
                    Text(agent.role)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(agent.status.color)
                }
            }
            Text(agent.line)
                .font(.caption)
                .foregroundStyle(FestivalDesign.secondaryText)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: 150, alignment: .leading)
        .padding(10)
        .background(FestivalDesign.cream.opacity(0.34))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                .stroke(agent.status.color.opacity(0.22), lineWidth: 1)
        )
    }
}

private struct ActivityFeed: View {
    let events: [AgentActivityEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("최근 활동")
                .font(.headline)
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
                    Text(event.agentId.uppercased())
                        .font(.caption.bold())
                        .foregroundStyle(accent)
                    Text(event.action)
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                    Spacer()
                    Text(shortTime(event.ts))
                        .font(.caption2)
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                Text(formatActivityLine(event) ?? (event.targetTitle ?? "—"))
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
            }
        }
    }

    private func shortTime(_ ts: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: ts) {
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

    enum Stage { case idle, walkingOut, reporting, walkingToWall, posting, returning, patrolling, validating }
    enum CarryKind { case festival, event }
}

private enum OfficeChoreography {
    private static let homes: [String: CGPoint] = [
        "festa":    CGPoint(x: 0.16, y: 0.44),
        "scout":    CGPoint(x: 0.84, y: 0.44),
        "orion":    CGPoint(x: 0.50, y: 0.34),
        "vera":     CGPoint(x: 0.36, y: 0.24),
        "pixel":    CGPoint(x: 0.64, y: 0.24),
        "echo":     CGPoint(x: 0.78, y: 0.74),
        "sentinel": CGPoint(x: 0.18, y: 0.16)
    ]

    private static let orionDesk = CGPoint(x: 0.50, y: 0.36)
    private static let wall = CGPoint(x: 0.50, y: 0.74)

    // Sentinel patrol corners
    private static let patrolPath: [CGPoint] = [
        CGPoint(x: 0.10, y: 0.16),
        CGPoint(x: 0.50, y: 0.10),
        CGPoint(x: 0.90, y: 0.16),
        CGPoint(x: 0.90, y: 0.62),
        CGPoint(x: 0.10, y: 0.62)
    ]

    static func frame(for agent: AgentOfficeAgent, at t: TimeInterval, snapshot: AgentOfficeSnapshot, hasLiveActivity: Bool) -> AgentFrame {
        let home = homes[agent.id] ?? CGPoint(x: 0.5, y: 0.5)
        guard agent.status.movesInOffice || hasLiveActivity else {
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
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
            let dir: PixelSprite.Direction = (Int(t) % 8 < 4) ? .down : .left
            return AgentFrame(position: home, direction: dir, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case "vera":
            return validatorFrame(t: t)
        case "pixel":
            return imageFrame(t: t, hasMissingImages: snapshot.missingImageCount > 0 || hasLiveActivity)
        case "echo":
            return publisherFrame(t: t, hasItems: snapshot.published.count > 0)
        case "sentinel":
            return patrolFrame(t: t)
        default:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
    }

    // 24-second cycle: home(5s) → walk to Orion(4s) → report(4s) → walk to wall(4s) → post(2s) → walk home(5s)
    private static func collectorFrame(id: String, t: TimeInterval, offset: Double,
                                       carry: AgentFrame.CarryKind, itemCount: Int) -> AgentFrame {
        let cycle: Double = 24
        let tau = (t + offset).truncatingRemainder(dividingBy: cycle)
        let home = homes[id]!
        let walking3 = Int(t * 6) % 3

        if itemCount == 0 {
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }

        switch tau {
        case 0..<5:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case 5..<9:
            let p = ease((tau - 5) / 4)
            let pos = routedLerp(home, orionDesk, p, corridorY: 0.48)
            let prev = routedLerp(home, orionDesk, max(0, p - 0.03), corridorY: 0.48)
            let dir = direction(from: prev, to: pos)
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .walkingOut, carry: carry)
        case 9..<13:
            let dir: PixelSprite.Direction = orionDesk.x > home.x ? .right : .left
            return AgentFrame(position: orionDesk, direction: dir, walking: false, walkPhase: 1,
                              stage: .reporting, carry: carry)
        case 13..<17:
            let p = ease((tau - 13) / 4)
            let pos = routedLerp(orionDesk, wall, p, corridorY: 0.58)
            let prev = routedLerp(orionDesk, wall, max(0, p - 0.03), corridorY: 0.58)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: carry)
        case 17..<19:
            return AgentFrame(position: wall, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: carry)
        default:
            let p = ease((tau - 19) / 5)
            let pos = routedLerp(wall, home, p, corridorY: 0.58)
            let prev = routedLerp(wall, home, max(0, p - 0.03), corridorY: 0.58)
            let dir = direction(from: prev, to: pos)
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .returning, carry: nil)
        }
    }

    private static func validatorFrame(t: TimeInterval) -> AgentFrame {
        // Vera oscillates between desk and Orion: validating role
        let home = homes["vera"]!
        let target = CGPoint(x: 0.44, y: 0.32)
        let cycle: Double = 8
        let tau = t.truncatingRemainder(dividingBy: cycle) / cycle
        let p = (sin(tau * .pi * 2) + 1) / 2
        let pos = routedLerp(home, target, p, corridorY: 0.34)
        let walking3 = Int(t * 4) % 3
        let walking = p > 0.05 && p < 0.95
        let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.34)
        let dir = direction(from: prev, to: pos)
        return AgentFrame(position: pos, direction: dir, walking: walking, walkPhase: walking3,
                          stage: .validating, carry: nil)
    }

    private static func imageFrame(t: TimeInterval, hasMissingImages: Bool) -> AgentFrame {
        let home = homes["pixel"]!
        guard hasMissingImages else {
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        let target = CGPoint(x: 0.58, y: 0.76)
        let cycle: Double = 18
        let tau = t.truncatingRemainder(dividingBy: cycle)
        let walking3 = Int(t * 6) % 3
        switch tau {
        case 0..<7:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .validating, carry: nil)
        case 7..<10:
            let p = ease((tau - 7) / 3)
            let pos = routedLerp(home, target, p, corridorY: 0.58)
            let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.58)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                              walking: true, walkPhase: walking3, stage: .walkingToWall, carry: nil)
        case 10..<13:
            return AgentFrame(position: target, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 13) / 5)
            let pos = routedLerp(target, home, p, corridorY: 0.58)
            let prev = routedLerp(target, home, max(0, p - 0.03), corridorY: 0.58)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                              walking: true, walkPhase: walking3, stage: .returning, carry: nil)
        }
    }

    private static func publisherFrame(t: TimeInterval, hasItems: Bool) -> AgentFrame {
        let home = homes["echo"]!
        let cycle: Double = 16
        let tau = t.truncatingRemainder(dividingBy: cycle)
        let walking3 = Int(t * 6) % 3
        guard hasItems else {
            return AgentFrame(position: home, direction: .left, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        }
        switch tau {
        case 0..<10:
            return AgentFrame(position: home, direction: .left, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case 10..<12:
            let p = ease((tau - 10) / 2)
            let target = CGPoint(x: 0.62, y: 0.76)
            let pos = routedLerp(home, target, p, corridorY: 0.76)
            let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.76)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: nil)
        case 12..<14:
            return AgentFrame(position: CGPoint(x: 0.62, y: 0.76), direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 14) / 2)
            let target = CGPoint(x: 0.62, y: 0.76)
            let pos = routedLerp(target, home, p, corridorY: 0.76)
            let prev = routedLerp(target, home, max(0, p - 0.03), corridorY: 0.76)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .returning, carry: nil)
        }
    }

    private static func patrolFrame(t: TimeInterval) -> AgentFrame {
        let segDuration: Double = 6
        let total = Double(patrolPath.count) * segDuration
        let tau = t.truncatingRemainder(dividingBy: total)
        let segIndex = Int(tau / segDuration)
        let local = (tau - Double(segIndex) * segDuration) / segDuration
        let from = patrolPath[segIndex]
        let to = patrolPath[(segIndex + 1) % patrolPath.count]
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
                          stage: .patrolling, carry: nil)
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
        case "vera", "sentinel":
            return Calendar.current.date(byAdding: .second, value: 20, to: date)
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

    private static func routedLerp(_ start: CGPoint, _ end: CGPoint, _ progress: Double, corridorY: CGFloat) -> CGPoint {
        let corridorStart = CGPoint(x: start.x, y: corridorY)
        let corridorEnd = CGPoint(x: end.x, y: corridorY)
        let rawPoints = [start, corridorStart, corridorEnd, end]
        let points = rawPoints.reduce(into: [CGPoint]()) { result, point in
            guard result.last.map({ distance($0, point) > 0.001 }) ?? true else { return }
            result.append(point)
        }
        return point(on: points, progress: progress)
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

    var body: some View {
        ZStack {
            // Shadow
            Ellipse()
                .fill(FestivalDesign.navy.opacity(0.18))
                .frame(width: 24, height: 6)
                .offset(y: 24)

            PixelSprite(
                sheet: agent.spriteAsset,
                direction: frame.direction,
                walking: frame.walking,
                walkPhase: frame.walkPhase,
                scale: 1.6
            )

            if let carry = frame.carry {
                CarryMarker(kind: carry)
                    .offset(x: 10, y: -16)
            }

            if let line = spokenLine {
                PixelBubble(text: line, speaker: agent.name, accent: agent.status.color)
                    .offset(y: -44)
            }

            Text(agent.name)
                .font(.system(size: 8, weight: .semibold))
                .padding(.horizontal, 3)
                .padding(.vertical, 1)
                .background(FestivalDesign.surface.opacity(0.9))
                .clipShape(Capsule())
                .offset(y: 32)
                .foregroundStyle(FestivalDesign.navy)
        }
        .frame(width: 90, height: 90)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role)\(spokenLine.map { ", \($0)" } ?? "")")
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
                .font(.system(size: 8))
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
                .font(.system(size: 7, weight: .heavy))
                .tracking(0.4)
                .foregroundStyle(accent)
            Text(text)
                .font(.system(size: 9))
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
        .shadow(color: FestivalDesign.navy.opacity(0.10), radius: 3, y: 1)
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

// MARK: - Pixel backdrop (diorama with depth)
//
// Layout zones (vertical):
//   y = 0.00 ~ 0.20  → back wall (paint band, clock, framed posters)
//   y = 0.20 ~ 0.34  → window strip + bookshelf + wainscoting top edge
//   y = 0.34 ~ 0.40  → wainscoting wood paneling + baseboard
//   y = 0.40 ~ 1.00  → wood plank floor with perspective lines + furniture
//
// Characters walk on the floor (their y is set by the choreography). The back wall
// reaches further down than the previous backdrop so the office feels enclosed,
// and a faint vignette + window light spill add depth without breaking pixel feel.

private struct PixelOfficeBackdrop: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            let wallBottom = h * 0.22

            ZStack {
                // 1. Floor (warm wood) — drawn first, full canvas
                FloorPlanks()

                // 2. Perspective lines on the floor (vanishing toward back wall center)
                FloorPerspective(wallBottomY: wallBottom)
                    .stroke(FestivalDesign.creamDeep.opacity(0.30),
                            style: StrokeStyle(lineWidth: 0.6, dash: [4, 6]))

                // 3. Soft floor rug under center desks
                OfficeRug()
                    .frame(width: w * 0.60, height: h * 0.18)
                    .position(x: w * 0.50, y: h * 0.58)

                // 4. Back wall (paint + wainscoting + baseboard)
                BackWall(bottomY: wallBottom)

                // 5. Window light spill on the floor (under each window)
                WindowLightSpill()
                    .frame(width: w * 0.18, height: h * 0.18)
                    .position(x: w * 0.30, y: wallBottom + h * 0.09)
                WindowLightSpill()
                    .frame(width: w * 0.18, height: h * 0.18)
                    .position(x: w * 0.70, y: wallBottom + h * 0.09)

                // 6. Wall fixtures
                OfficeWindow()
                    .frame(width: w * 0.20, height: h * 0.14)
                    .position(x: w * 0.30, y: h * 0.11)
                OfficeWindow()
                    .frame(width: w * 0.20, height: h * 0.14)
                    .position(x: w * 0.70, y: h * 0.11)

                WallClock()
                    .frame(width: 22, height: 22)
                    .position(x: w * 0.50, y: h * 0.07)

                FramedPoster(accent: FestivalDesign.lantern, glyph: "🎪")
                    .frame(width: 22, height: 16)
                    .position(x: w * 0.50, y: h * 0.15)

                Bookshelf()
                    .frame(width: w * 0.13, height: h * 0.20)
                    .position(x: w * 0.07, y: h * 0.18)

                FilingCabinet()
                    .frame(width: w * 0.11, height: h * 0.16)
                    .position(x: w * 0.93, y: h * 0.20)

                // 7. Floor furniture (drawn after wall so chairs can extend down)
                IsoDesk(label: "축제팀", accent: FestivalDesign.lantern)
                    .position(x: w * 0.16, y: h * 0.50)
                IsoDesk(label: "총괄", accent: FestivalDesign.coral, large: true)
                    .position(x: w * 0.50, y: h * 0.42)
                IsoDesk(label: "이벤트팀", accent: FestivalDesign.parkingBlue)
                    .position(x: w * 0.84, y: h * 0.50)

                IsoDesk(label: "검증", accent: FestivalDesign.teal, small: true)
                    .position(x: w * 0.36, y: h * 0.30)

                IsoDesk(label: "홍보", accent: FestivalDesign.coral.opacity(0.75), small: true)
                    .position(x: w * 0.80, y: h * 0.78)

                CoffeeStation()
                    .frame(width: 26, height: 30)
                    .position(x: w * 0.07, y: h * 0.50)

                WaterCooler()
                    .frame(width: 20, height: 32)
                    .position(x: w * 0.93, y: h * 0.50)

                OfficePlant()
                    .frame(width: 18, height: 26)
                    .position(x: w * 0.06, y: h * 0.74)
                OfficePlant()
                    .frame(width: 18, height: 26)
                    .position(x: w * 0.94, y: h * 0.74)

                // 8. Subtle ambient vignette for room depth
                RadialGradient(
                    colors: [Color.clear, FestivalDesign.navy.opacity(0.10)],
                    center: .center,
                    startRadius: min(w, h) * 0.35,
                    endRadius: max(w, h) * 0.70
                )
                .allowsHitTesting(false)

                // 9. Live indicator chip
                HStack(spacing: 5) {
                    Circle()
                        .fill(FestivalDesign.teal)
                        .frame(width: 6, height: 6)
                    Text("업무 진행 중")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(FestivalDesign.navy)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(FestivalDesign.surface.opacity(0.92))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(FestivalDesign.creamDeep.opacity(0.6), lineWidth: 0.5))
                .position(x: w - 62, y: 26)
            }
        }
    }
}

// MARK: - Floor

private struct FloorPlanks: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    FestivalDesign.cream.opacity(0.55),
                    Color(red: 0.96, green: 0.88, blue: 0.74),
                    Color(red: 0.85, green: 0.74, blue: 0.58)
                ],
                startPoint: .top, endPoint: .bottom
            )
            PlankStripes()
                .stroke(FestivalDesign.navy.opacity(0.10), lineWidth: 0.6)
        }
    }
}

private struct PlankStripes: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let step: CGFloat = 14
        var y = rect.minY
        while y <= rect.maxY {
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
            y += step
        }
        // Stagger short marks to suggest plank seams
        var row = 0
        y = rect.minY
        while y <= rect.maxY {
            let offset: CGFloat = (row % 2 == 0) ? 0 : 28
            var x = rect.minX + offset
            while x < rect.maxX {
                path.move(to: CGPoint(x: x, y: y))
                path.addLine(to: CGPoint(x: x, y: y + step))
                x += 56
            }
            y += step
            row += 1
        }
        return path
    }
}

private struct FloorPerspective: Shape {
    let wallBottomY: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let vanish = CGPoint(x: rect.midX, y: wallBottomY)
        // Three lines fanning out from the vanishing point toward the bottom edge
        let xs: [CGFloat] = [rect.minX + rect.width * 0.10,
                             rect.minX + rect.width * 0.30,
                             rect.midX,
                             rect.minX + rect.width * 0.70,
                             rect.maxX - rect.width * 0.10]
        for x in xs {
            path.move(to: vanish)
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
        }
        return path
    }
}

private struct OfficeRug: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(FestivalDesign.tealSoft.opacity(0.85))
            RoundedRectangle(cornerRadius: 6)
                .stroke(FestivalDesign.teal.opacity(0.45), lineWidth: 2)
                .padding(4)
            // Diamond pattern
            Path { p in
                let step: CGFloat = 18
                var x: CGFloat = -step
                while x < 400 {
                    p.move(to: CGPoint(x: x, y: 0))
                    p.addLine(to: CGPoint(x: x + 80, y: 80))
                    x += step
                }
                x = -step
                while x < 400 {
                    p.move(to: CGPoint(x: x + 80, y: 0))
                    p.addLine(to: CGPoint(x: x, y: 80))
                    x += step
                }
            }
            .stroke(FestivalDesign.teal.opacity(0.18), lineWidth: 0.7)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .shadow(color: FestivalDesign.navy.opacity(0.08), radius: 2, y: 1)
    }
}

// MARK: - Back wall

private struct BackWall: View {
    let bottomY: CGFloat
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            ZStack(alignment: .top) {
                // Upper paint band
                Rectangle()
                    .fill(LinearGradient(
                        colors: [
                            Color(red: 0.95, green: 0.91, blue: 0.84),
                            Color(red: 0.92, green: 0.87, blue: 0.78)
                        ],
                        startPoint: .top, endPoint: .bottom))
                    .frame(width: w, height: bottomY - 14)

                // Wainscoting (wood paneling, darker)
                Rectangle()
                    .fill(Color(red: 0.74, green: 0.62, blue: 0.48))
                    .frame(width: w, height: 14)
                    .overlay(WainscotingPanels().stroke(FestivalDesign.navy.opacity(0.22), lineWidth: 0.7))
                    .offset(y: bottomY - 14)

                // Top molding line
                Rectangle()
                    .fill(FestivalDesign.navy.opacity(0.18))
                    .frame(width: w, height: 1)
                    .offset(y: bottomY - 14)

                // Baseboard (bottom of wall meeting floor)
                Rectangle()
                    .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
                    .frame(width: w, height: 3)
                    .offset(y: bottomY - 3)

                // Subtle shadow gradient at the wall-floor junction
                LinearGradient(
                    colors: [FestivalDesign.navy.opacity(0.18), Color.clear],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(width: w, height: 18)
                .offset(y: bottomY)
                .blendMode(.multiply)
                .allowsHitTesting(false)
            }
        }
    }
}

private struct WainscotingPanels: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let panelW: CGFloat = 26
        var x = rect.minX
        while x < rect.maxX {
            path.move(to: CGPoint(x: x, y: rect.minY + 2))
            path.addLine(to: CGPoint(x: x, y: rect.maxY - 2))
            x += panelW
        }
        return path
    }
}

private struct OfficeWindow: View {
    var body: some View {
        ZStack {
            // Outer frame
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
            // Sky + buildings (inside window)
            RoundedRectangle(cornerRadius: 1.5)
                .fill(LinearGradient(
                    colors: [
                        Color(red: 0.74, green: 0.88, blue: 0.98),
                        Color(red: 0.92, green: 0.95, blue: 1.0)
                    ],
                    startPoint: .top, endPoint: .bottom))
                .padding(2)
            // Distant buildings
            GeometryReader { proxy in
                let w = proxy.size.width
                let h = proxy.size.height
                ZStack(alignment: .bottom) {
                    Color.clear
                    HStack(alignment: .bottom, spacing: 1) {
                        Rectangle().fill(FestivalDesign.navy.opacity(0.30)).frame(width: w * 0.12, height: h * 0.40)
                        Rectangle().fill(FestivalDesign.navy.opacity(0.20)).frame(width: w * 0.18, height: h * 0.55)
                        Rectangle().fill(FestivalDesign.navy.opacity(0.28)).frame(width: w * 0.10, height: h * 0.30)
                        Rectangle().fill(FestivalDesign.navy.opacity(0.22)).frame(width: w * 0.20, height: h * 0.48)
                        Rectangle().fill(FestivalDesign.navy.opacity(0.26)).frame(width: w * 0.14, height: h * 0.36)
                        Rectangle().fill(FestivalDesign.navy.opacity(0.20)).frame(width: w * 0.18, height: h * 0.50)
                    }
                    .padding(.horizontal, 3)
                    .padding(.bottom, 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 1.5).inset(by: 2))
            // Cross mullions
            Rectangle()
                .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
                .frame(width: 1.5)
            Rectangle()
                .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
                .frame(height: 1.5)
            // Sill
            RoundedRectangle(cornerRadius: 1)
                .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
                .frame(height: 3)
                .offset(y: 2)
                .padding(.horizontal, -2)
                .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .shadow(color: FestivalDesign.navy.opacity(0.15), radius: 1.5, x: 0, y: 1)
    }
}

private struct WindowLightSpill: View {
    var body: some View {
        Trapezoid()
            .fill(LinearGradient(
                colors: [
                    FestivalDesign.lantern.opacity(0.32),
                    FestivalDesign.lantern.opacity(0.0)
                ],
                startPoint: .top, endPoint: .bottom))
            .allowsHitTesting(false)
    }
}

private struct WallClock: View {
    var body: some View {
        ZStack {
            Circle().fill(FestivalDesign.surface)
            Circle().stroke(FestivalDesign.navy.opacity(0.85), lineWidth: 1.5)
            // Tick marks
            ForEach(0..<12) { i in
                Rectangle()
                    .fill(FestivalDesign.navy.opacity(0.6))
                    .frame(width: 1, height: 2.5)
                    .offset(y: -8)
                    .rotationEffect(.degrees(Double(i) * 30))
            }
            // Hands
            Rectangle().fill(FestivalDesign.navy).frame(width: 1.2, height: 6).offset(y: -3)
            Rectangle().fill(FestivalDesign.coral).frame(width: 1, height: 8).offset(y: -4)
                .rotationEffect(.degrees(110))
            Circle().fill(FestivalDesign.coral).frame(width: 2, height: 2)
        }
        .shadow(color: FestivalDesign.navy.opacity(0.15), radius: 1, y: 1)
    }
}

private struct FramedPoster: View {
    let accent: Color
    let glyph: String
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 1)
                .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
            RoundedRectangle(cornerRadius: 0.5)
                .fill(accent.opacity(0.85))
                .padding(2)
            Text(glyph)
                .font(.system(size: 11))
        }
        .shadow(color: FestivalDesign.navy.opacity(0.15), radius: 1, y: 1)
    }
}

private struct Bookshelf: View {
    var body: some View {
        ZStack {
            // Carcass
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(red: 0.55, green: 0.42, blue: 0.30))
            // Shelves with books
            VStack(spacing: 1) {
                ForEach(0..<3) { _ in
                    HStack(spacing: 1) {
                        BookSpine(color: FestivalDesign.coral)
                        BookSpine(color: FestivalDesign.teal)
                        BookSpine(color: FestivalDesign.lantern)
                        BookSpine(color: FestivalDesign.parkingBlue)
                        BookSpine(color: FestivalDesign.coral.opacity(0.7))
                    }
                    .padding(.horizontal, 2)
                }
            }
            .padding(.vertical, 3)
        }
        .shadow(color: FestivalDesign.navy.opacity(0.18), radius: 1.5, y: 1)
    }
}

private struct BookSpine: View {
    let color: Color
    var body: some View {
        RoundedRectangle(cornerRadius: 0.5)
            .fill(color.opacity(0.9))
            .overlay(
                Rectangle()
                    .fill(FestivalDesign.surface.opacity(0.7))
                    .frame(height: 0.6)
            )
    }
}

private struct FilingCabinet: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .fill(LinearGradient(
                    colors: [Color(red: 0.78, green: 0.78, blue: 0.80),
                             Color(red: 0.62, green: 0.62, blue: 0.66)],
                    startPoint: .topLeading, endPoint: .bottomTrailing))
            VStack(spacing: 2) {
                ForEach(0..<3) { _ in
                    RoundedRectangle(cornerRadius: 0.5)
                        .fill(FestivalDesign.navy.opacity(0.22))
                        .frame(height: 8)
                        .overlay(
                            Circle()
                                .fill(FestivalDesign.navy.opacity(0.6))
                                .frame(width: 2, height: 2)
                        )
                        .padding(.horizontal, 2)
                }
            }
            .padding(.vertical, 2)
        }
        .shadow(color: FestivalDesign.navy.opacity(0.20), radius: 1.5, y: 1)
    }
}

// MARK: - Floor furniture

private struct IsoDesk: View {
    let label: String
    let accent: Color
    var large: Bool = false
    var small: Bool = false

    private var deskW: CGFloat { large ? 56 : (small ? 36 : 46) }
    private var deskH: CGFloat { large ? 14 : (small ? 9 : 11) }

    var body: some View {
        VStack(spacing: 1) {
            ZStack {
                // Ground shadow
                Ellipse()
                    .fill(FestivalDesign.navy.opacity(0.16))
                    .frame(width: deskW + 6, height: 5)
                    .offset(y: deskH * 0.55 + 8)

                // Front face of desk (gives depth)
                Rectangle()
                    .fill(Color(red: 0.62, green: 0.48, blue: 0.34))
                    .frame(width: deskW, height: 7)
                    .offset(y: deskH * 0.5 + 3)

                // Desk top (lighter wood)
                RoundedRectangle(cornerRadius: 1)
                    .fill(LinearGradient(
                        colors: [
                            Color(red: 0.92, green: 0.80, blue: 0.62),
                            Color(red: 0.80, green: 0.66, blue: 0.48)
                        ],
                        startPoint: .top, endPoint: .bottom))
                    .frame(width: deskW, height: deskH)
                    .overlay(
                        RoundedRectangle(cornerRadius: 1)
                            .stroke(FestivalDesign.navy.opacity(0.22), lineWidth: 0.7)
                    )

                // Monitor (CRT-ish)
                ZStack {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(FestivalDesign.navy.opacity(0.9))
                        .frame(width: large ? 18 : 14, height: large ? 12 : 9)
                    Rectangle()
                        .fill(accent.opacity(0.85))
                        .frame(width: large ? 14 : 10, height: large ? 8 : 6)
                    Rectangle()
                        .fill(FestivalDesign.surface.opacity(0.35))
                        .frame(width: 2, height: large ? 6 : 4)
                        .offset(x: large ? -4 : -3, y: -1)
                }
                .offset(y: -deskH * 0.4 - (large ? 4 : 3))

                // Monitor stand
                Rectangle()
                    .fill(FestivalDesign.navy.opacity(0.7))
                    .frame(width: 2, height: 3)
                    .offset(y: -deskH * 0.4 + (large ? 2 : 1))

                // Desk lamp
                if !small {
                    LampGlyph()
                        .offset(x: deskW * 0.32, y: -deskH * 0.4 - 2)
                }

                // Papers / notebook
                RoundedRectangle(cornerRadius: 0.5)
                    .fill(FestivalDesign.surface)
                    .frame(width: 5, height: 4)
                    .overlay(
                        RoundedRectangle(cornerRadius: 0.5)
                            .stroke(FestivalDesign.navy.opacity(0.4), lineWidth: 0.4)
                    )
                    .offset(x: -deskW * 0.28, y: -deskH * 0.1)

                // Chair (small back visible behind desk)
                Rectangle()
                    .fill(accent.opacity(0.85))
                    .frame(width: deskW * 0.35, height: 4)
                    .overlay(
                        Rectangle().stroke(FestivalDesign.navy.opacity(0.35), lineWidth: 0.4)
                    )
                    .offset(y: deskH * 0.55 + 10)
            }
            Text(label)
                .font(.system(size: 7, weight: .bold))
                .padding(.horizontal, 3)
                .padding(.vertical, 0.5)
                .background(FestivalDesign.surface.opacity(0.9))
                .clipShape(Capsule())
                .foregroundStyle(FestivalDesign.navy.opacity(0.85))
                .offset(y: 4)
        }
    }
}

private struct LampGlyph: View {
    var body: some View {
        ZStack {
            // Shade
            Trapezoid()
                .fill(FestivalDesign.lantern.opacity(0.9))
                .frame(width: 6, height: 4)
                .overlay(Trapezoid().stroke(FestivalDesign.navy.opacity(0.4), lineWidth: 0.4))
            // Arm
            Rectangle()
                .fill(FestivalDesign.navy.opacity(0.7))
                .frame(width: 0.8, height: 3)
                .offset(y: 3)
            // Base
            Rectangle()
                .fill(FestivalDesign.navy.opacity(0.7))
                .frame(width: 4, height: 1)
                .offset(y: 5)
        }
    }
}

private struct CoffeeStation: View {
    var body: some View {
        VStack(spacing: 1) {
            // Coffee maker
            ZStack {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(FestivalDesign.navy.opacity(0.85))
                    .frame(width: 14, height: 14)
                Circle()
                    .fill(FestivalDesign.coral.opacity(0.85))
                    .frame(width: 5, height: 5)
                    .offset(y: -1)
                Rectangle()
                    .fill(FestivalDesign.lantern)
                    .frame(width: 8, height: 2)
                    .offset(y: 4)
            }
            // Counter (front edge gives depth)
            ZStack {
                Rectangle()
                    .fill(Color(red: 0.62, green: 0.48, blue: 0.34))
                    .frame(width: 22, height: 4)
                    .offset(y: 4)
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(red: 0.85, green: 0.74, blue: 0.58))
                    .frame(width: 22, height: 5)
                    .overlay(
                        RoundedRectangle(cornerRadius: 1)
                            .stroke(FestivalDesign.navy.opacity(0.22), lineWidth: 0.5)
                    )
                // A coffee mug
                Circle()
                    .fill(FestivalDesign.surface)
                    .frame(width: 3, height: 3)
                    .offset(x: 6, y: -1)
            }
        }
        .shadow(color: FestivalDesign.navy.opacity(0.15), radius: 1, y: 1)
    }
}

private struct WaterCooler: View {
    var body: some View {
        VStack(spacing: -1) {
            // Bottle
            ZStack {
                RoundedRectangle(cornerRadius: 3)
                    .fill(FestivalDesign.tealSoft.opacity(0.85))
                    .frame(width: 12, height: 13)
                    .overlay(
                        RoundedRectangle(cornerRadius: 3)
                            .stroke(FestivalDesign.teal.opacity(0.55), lineWidth: 0.5)
                    )
                Ellipse()
                    .fill(FestivalDesign.surface.opacity(0.5))
                    .frame(width: 3, height: 5)
                    .offset(x: -3, y: -2)
            }
            // Body
            ZStack {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(red: 0.85, green: 0.85, blue: 0.88))
                    .frame(width: 14, height: 16)
                    .overlay(
                        RoundedRectangle(cornerRadius: 1)
                            .stroke(FestivalDesign.navy.opacity(0.30), lineWidth: 0.6)
                    )
                // Tap
                Rectangle()
                    .fill(FestivalDesign.navy.opacity(0.7))
                    .frame(width: 4, height: 2)
                    .offset(y: -2)
                // Indicator light
                Circle()
                    .fill(FestivalDesign.teal)
                    .frame(width: 1.5, height: 1.5)
                    .offset(x: 4, y: 5)
            }
        }
        .shadow(color: FestivalDesign.navy.opacity(0.20), radius: 1.5, y: 1)
    }
}

private struct OfficePlant: View {
    var body: some View {
        VStack(spacing: -3) {
            // Leaves
            ZStack {
                Capsule()
                    .fill(FestivalDesign.teal.opacity(0.9))
                    .frame(width: 4, height: 14)
                    .rotationEffect(.degrees(-20))
                    .offset(x: -3)
                Capsule()
                    .fill(FestivalDesign.teal)
                    .frame(width: 4, height: 16)
                    .offset(y: -1)
                Capsule()
                    .fill(FestivalDesign.teal.opacity(0.85))
                    .frame(width: 4, height: 13)
                    .rotationEffect(.degrees(22))
                    .offset(x: 3, y: 1)
            }
            // Pot
            Trapezoid()
                .fill(LinearGradient(
                    colors: [Color(red: 0.78, green: 0.55, blue: 0.42),
                             Color(red: 0.58, green: 0.38, blue: 0.28)],
                    startPoint: .top, endPoint: .bottom))
                .frame(width: 14, height: 10)
                .overlay(Trapezoid().stroke(FestivalDesign.navy.opacity(0.3), lineWidth: 0.5))
            // Saucer shadow
            Ellipse()
                .fill(FestivalDesign.navy.opacity(0.18))
                .frame(width: 16, height: 3)
        }
    }
}

private struct Trapezoid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.18, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.18, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Published wall

private struct PublishedWall: View {
    let items: [DiscoveryItem]

    var body: some View {
        ZStack {
            // Cork board
            RoundedRectangle(cornerRadius: 6)
                .fill(FestivalDesign.lantern.opacity(0.28))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(FestivalDesign.creamDeep, lineWidth: 1.4)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(FestivalDesign.navy.opacity(0.10), lineWidth: 0.5)
                        .padding(3)
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("게시판")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(FestivalDesign.navy)
                    Spacer()
                    Text("\(items.count)건")
                        .font(.system(size: 8))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
                if items.isEmpty {
                    Text("아직 게시된 항목이 없어요.")
                        .font(.system(size: 9))
                        .foregroundStyle(FestivalDesign.secondaryText)
                } else {
                    HStack(spacing: 4) {
                        ForEach(items.prefix(6)) { item in
                            PublishedCard(item: item)
                        }
                    }
                }
            }
            .padding(6)
        }
    }
}

private struct PublishedCard: View {
    let item: DiscoveryItem

    var body: some View {
        VStack(spacing: 2) {
            Text(symbol)
                .font(.system(size: 11))
            Text(item.title)
                .font(.system(size: 7, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(3)
        .frame(maxWidth: .infinity, minHeight: 36)
        .background(FestivalDesign.surface.opacity(0.95))
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(accent.opacity(0.6), lineWidth: 1)
        )
        .overlay(
            Circle()
                .fill(FestivalDesign.coral)
                .frame(width: 4, height: 4)
                .offset(y: -16),
            alignment: .top
        )
    }

    private var symbol: String {
        switch item.kind {
        case .festival: return "🎪"
        case .event: return "🎟"
        }
    }

    private var accent: Color {
        switch item.kind {
        case .festival: return FestivalDesign.lantern
        case .event: return FestivalDesign.parkingBlue
        }
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
                    .font(.subheadline.bold())
                    .foregroundStyle(FestivalDesign.navy)
                Text(provider.lastError ?? "품질 \(Int(provider.qualityScore * 100))%")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
            Text(providerStatusText)
                .font(.caption.bold())
                .foregroundStyle(color)
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
