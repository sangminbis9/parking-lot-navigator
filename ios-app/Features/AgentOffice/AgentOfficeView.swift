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
        .festivalNavigationTitle("에이전트 사무실")
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
        Text("스프라이트: harishkotra/agent-office (MIT) · 가구: Antea/stcrbcn (CC-BY 4.0)")
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
                        .frame(width: size.width * 0.52, height: size.height * 0.17)
                        .position(x: size.width * 0.50, y: size.height * 0.18)

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
        "festa":    CGPoint(x: 0.24, y: 0.54),
        "scout":    CGPoint(x: 0.76, y: 0.54),
        "orion":    CGPoint(x: 0.50, y: 0.48),
        "vera":     CGPoint(x: 0.36, y: 0.58),
        "pixel":    CGPoint(x: 0.64, y: 0.58),
        "echo":     CGPoint(x: 0.74, y: 0.78),
        "sentinel": CGPoint(x: 0.14, y: 0.70)
    ]

    private static let orionDesk = CGPoint(x: 0.50, y: 0.51)
    private static let boardDrop = CGPoint(x: 0.50, y: 0.74)

    // Sentinel patrol corners
    private static let patrolPath: [CGPoint] = [
        CGPoint(x: 0.14, y: 0.66),
        CGPoint(x: 0.32, y: 0.62),
        CGPoint(x: 0.68, y: 0.62),
        CGPoint(x: 0.88, y: 0.70),
        CGPoint(x: 0.78, y: 0.84),
        CGPoint(x: 0.22, y: 0.84)
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

    // 24-second cycle: home(5s) → walk to Orion(4s) → report(4s) → walk to board drop-off(4s) → post(2s) → walk home(5s)
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
            let pos = routedLerp(home, orionDesk, p, corridorY: 0.62)
            let prev = routedLerp(home, orionDesk, max(0, p - 0.03), corridorY: 0.62)
            let dir = direction(from: prev, to: pos)
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .walkingOut, carry: carry)
        case 9..<13:
            let dir: PixelSprite.Direction = orionDesk.x > home.x ? .right : .left
            return AgentFrame(position: orionDesk, direction: dir, walking: false, walkPhase: 1,
                              stage: .reporting, carry: carry)
        case 13..<17:
            let p = ease((tau - 13) / 4)
            let pos = routedLerp(orionDesk, boardDrop, p, corridorY: 0.68)
            let prev = routedLerp(orionDesk, boardDrop, max(0, p - 0.03), corridorY: 0.68)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: carry)
        case 17..<19:
            return AgentFrame(position: boardDrop, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: carry)
        default:
            let p = ease((tau - 19) / 5)
            let pos = routedLerp(boardDrop, home, p, corridorY: 0.68)
            let prev = routedLerp(boardDrop, home, max(0, p - 0.03), corridorY: 0.68)
            let dir = direction(from: prev, to: pos)
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .returning, carry: nil)
        }
    }

    private static func validatorFrame(t: TimeInterval) -> AgentFrame {
        // Vera oscillates between desk and Orion: validating role
        let home = homes["vera"]!
        let target = CGPoint(x: 0.46, y: 0.54)
        let cycle: Double = 8
        let tau = t.truncatingRemainder(dividingBy: cycle) / cycle
        let p = (sin(tau * .pi * 2) + 1) / 2
        let pos = routedLerp(home, target, p, corridorY: 0.62)
        let walking3 = Int(t * 4) % 3
        let walking = p > 0.05 && p < 0.95
        let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.62)
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
        let target = CGPoint(x: 0.56, y: 0.76)
        let cycle: Double = 18
        let tau = t.truncatingRemainder(dividingBy: cycle)
        let walking3 = Int(t * 6) % 3
        switch tau {
        case 0..<7:
            return AgentFrame(position: home, direction: .down, walking: false, walkPhase: 1,
                              stage: .validating, carry: nil)
        case 7..<10:
            let p = ease((tau - 7) / 3)
            let pos = routedLerp(home, target, p, corridorY: 0.68)
            let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.68)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos),
                              walking: true, walkPhase: walking3, stage: .walkingToWall, carry: nil)
        case 10..<13:
            return AgentFrame(position: target, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 13) / 5)
            let pos = routedLerp(target, home, p, corridorY: 0.68)
            let prev = routedLerp(target, home, max(0, p - 0.03), corridorY: 0.68)
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
            let target = CGPoint(x: 0.58, y: 0.76)
            let pos = routedLerp(home, target, p, corridorY: 0.84)
            let prev = routedLerp(home, target, max(0, p - 0.03), corridorY: 0.84)
            return AgentFrame(position: pos, direction: direction(from: prev, to: pos), walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: nil)
        case 12..<14:
            return AgentFrame(position: CGPoint(x: 0.58, y: 0.76), direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 14) / 2)
            let target = CGPoint(x: 0.58, y: 0.76)
            let pos = routedLerp(target, home, p, corridorY: 0.84)
            let prev = routedLerp(target, home, max(0, p - 0.03), corridorY: 0.84)
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

// MARK: - Pixel backdrop (PNG sprite scene)

private struct PixelOfficeBackdrop: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            let wallBottom = h * 0.30

            ZStack {
                Group {
                    PixelTileFloor()
                        .frame(width: w, height: h - wallBottom)
                        .position(x: w * 0.50, y: wallBottom + (h - wallBottom) / 2)

                    BackWallBand()
                        .frame(width: w, height: wallBottom)
                        .position(x: w * 0.50, y: wallBottom / 2)

                    OfficeRug()
                        .frame(width: w * 0.54, height: h * 0.13)
                        .position(x: w * 0.50, y: h * 0.66)
                }

                Group {
                    Pixel16("Wall-Clock").position(x: w * 0.50, y: h * 0.04)
                    Pixel16("Wall-Shelf").position(x: w * 0.14, y: h * 0.20)
                    Pixel16("Wall-Graph").position(x: w * 0.86, y: h * 0.20)
                }

                Group {
                    Pixel32("Filing-Cabinet-Tall").position(x: w * 0.18, y: h * 0.35)
                    Pixel32("Desk-2").position(x: w * 0.34, y: h * 0.34)
                    Pixel16("Folders").position(x: w * 0.40, y: h * 0.32)

                    Pixel32("Desk-2").position(x: w * 0.66, y: h * 0.34)
                    Pixel16("Books").position(x: w * 0.60, y: h * 0.32)
                    Pixel32("Filing-Cabinet-Open").position(x: w * 0.82, y: h * 0.35)
                }

                Group {
                    Pixel32("Boss-Desk").position(x: w * 0.50, y: h * 0.39)
                    Pixel32("Boss-Chair").position(x: w * 0.50, y: h * 0.44)
                    Pixel16("Papers").position(x: w * 0.44, y: h * 0.37)
                    Pixel16("Folders-2").position(x: w * 0.56, y: h * 0.37)
                }

                Group {
                    Pixel32("Desk").position(x: w * 0.14, y: h * 0.48)
                    Pixel16("Folders").position(x: w * 0.14, y: h * 0.45)
                    Pixel32("Filing-Cabinet-Tall").position(x: w * 0.05, y: h * 0.48)
                }

                Group {
                    Pixel32("Desk").position(x: w * 0.86, y: h * 0.48)
                    Pixel16("Folders-2").position(x: w * 0.86, y: h * 0.45)
                    Pixel32("Filing-Cabinet-Tall").position(x: w * 0.95, y: h * 0.48)
                }

                Group {
                    Pixel32("Desk").position(x: w * 0.80, y: h * 0.78)
                    Pixel16("Printer").position(x: w * 0.88, y: h * 0.77)
                    Pixel16("Papers").position(x: w * 0.80, y: h * 0.75)
                }

                Group {
                    Pixel32("Water-Dispenser").position(x: w * 0.06, y: h * 0.58)
                    Pixel16("Coffee-Machine").position(x: w * 0.06, y: h * 0.72)
                    Pixel32("Big-Plant").position(x: w * 0.05, y: h * 0.90)
                    Pixel32("Big-Plant").position(x: w * 0.95, y: h * 0.90)
                    Pixel32("Vending-Machine").position(x: w * 0.22, y: h * 0.91)
                    Pixel32("Big-Office-Printer").position(x: w * 0.94, y: h * 0.66)
                    Pixel32("Tall-Bookshelf").position(x: w * 0.35, y: h * 0.91)
                    Pixel32("Big-Round-Table").position(x: w * 0.48, y: h * 0.82)
                    Pixel16("Small-Plant").position(x: w * 0.62, y: h * 0.91)
                }

                HStack(spacing: 4) {
                    Rectangle()
                        .fill(FestivalDesign.teal)
                        .frame(width: 6, height: 6)
                    Text("업무 진행 중")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(FestivalDesign.navy)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(FestivalDesign.surface)
                .overlay(Rectangle().stroke(FestivalDesign.navy.opacity(0.7), lineWidth: 1))
                .position(x: w - 62, y: 22)
            }
        }
    }
}

private struct Pixel16: View {
    let name: String
    let scale: CGFloat
    init(_ name: String, scale: CGFloat = 1.6) {
        self.name = name
        self.scale = scale
    }
    var body: some View {
        Image(name)
            .resizable()
            .interpolation(.none)
            .frame(width: 16 * scale, height: 16 * scale)
    }
}

private struct Pixel32: View {
    let name: String
    let scale: CGFloat
    init(_ name: String, scale: CGFloat = 1.6) {
        self.name = name
        self.scale = scale
    }
    var body: some View {
        Image(name)
            .resizable()
            .interpolation(.none)
            .frame(width: 32 * scale, height: 32 * scale)
    }
}

private struct BackWallBand: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            ZStack(alignment: .bottom) {
                Rectangle()
                    .fill(Color(red: 0.89, green: 0.86, blue: 0.78))
                    .frame(width: w, height: h)
                HStack(spacing: 8) {
                    PixelWindow()
                    Color.clear
                        .frame(width: w * 0.48)
                    PixelWindow()
                }
                .frame(width: w * 0.94, height: h * 0.68)
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 12)
                Rectangle()
                    .fill(Color(red: 0.74, green: 0.58, blue: 0.42))
                    .frame(width: w, height: 6)
                Rectangle()
                    .fill(Color(red: 0.40, green: 0.27, blue: 0.18))
                    .frame(width: w, height: 2)
            }
        }
    }
}

private struct PixelWindow: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            ZStack {
                Rectangle()
                    .fill(Color(red: 0.53, green: 0.78, blue: 0.92))
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.45),
                                Color(red: 0.64, green: 0.86, blue: 0.96).opacity(0.15)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                PixelSkyline()
                    .fill(Color(red: 0.36, green: 0.55, blue: 0.68).opacity(0.45))
                    .frame(width: w, height: h * 0.45)
                    .position(x: w * 0.50, y: h * 0.78)
                Rectangle()
                    .fill(Color(red: 0.34, green: 0.23, blue: 0.17))
                    .frame(width: 3)
                Rectangle()
                    .fill(Color(red: 0.34, green: 0.23, blue: 0.17))
                    .frame(height: 3)
                Rectangle()
                    .stroke(Color(red: 0.25, green: 0.16, blue: 0.11), lineWidth: 3)
            }
        }
    }
}

private struct PixelSkyline: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        let widths: [CGFloat] = [0.12, 0.10, 0.18, 0.09, 0.16, 0.13, 0.12]
        var x = rect.minX
        for (index, widthRatio) in widths.enumerated() {
            let width = rect.width * widthRatio
            let top = rect.minY + rect.height * CGFloat([0.45, 0.20, 0.35, 0.10, 0.50, 0.28, 0.42][index])
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
            path.addLine(to: CGPoint(x: x, y: top))
            path.addLine(to: CGPoint(x: x + width, y: top))
            path.addLine(to: CGPoint(x: x + width, y: rect.maxY))
            x += width
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Floor

private struct PixelTileFloor: View {
    var body: some View {
        Canvas { context, size in
            let tile: CGFloat = 16
            let light = Color(red: 0.91, green: 0.80, blue: 0.62)
            let mid = Color(red: 0.84, green: 0.70, blue: 0.50)
            let dark = Color(red: 0.74, green: 0.58, blue: 0.39)
            let grout = Color(red: 0.30, green: 0.20, blue: 0.12).opacity(0.45)
            let dot = Color(red: 0.48, green: 0.32, blue: 0.20).opacity(0.35)

            let cols = Int(ceil(size.width / tile)) + 1
            let rows = Int(ceil(size.height / tile)) + 1
            for r in 0..<rows {
                for c in 0..<cols {
                    let x = CGFloat(c) * tile
                    let y = CGFloat(r) * tile
                    let palette = (c + r) % 4
                    let rect = CGRect(x: x, y: y, width: tile, height: tile)
                    let color = palette == 0 ? light : (palette == 2 ? dark : mid)
                    context.fill(Path(rect), with: .color(color))
                    let inset: CGFloat = 5
                    let dotRect = CGRect(x: x + inset, y: y + inset, width: 3, height: 3)
                    context.fill(Path(dotRect), with: .color(dot))
                }
            }
            for c in 0...cols {
                let x = CGFloat(c) * tile
                var p = Path()
                p.move(to: CGPoint(x: x, y: 0))
                p.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(p, with: .color(grout), lineWidth: 1)
            }
            for r in 0...rows {
                let y = CGFloat(r) * tile
                var p = Path()
                p.move(to: CGPoint(x: 0, y: y))
                p.addLine(to: CGPoint(x: size.width, y: y))
                context.stroke(p, with: .color(grout), lineWidth: 1)
            }
        }
    }
}

private struct OfficeRug: View {
    var body: some View {
        Canvas { context, size in
            let cols = 6
            let rows = 3
            let cellW = size.width / CGFloat(cols)
            let cellH = size.height / CGFloat(rows)
            let a = FestivalDesign.tealSoft
            let b = FestivalDesign.teal.opacity(0.45)
            for r in 0..<rows {
                for c in 0..<cols {
                    let rect = CGRect(x: CGFloat(c) * cellW, y: CGFloat(r) * cellH,
                                      width: cellW, height: cellH)
                    let isA = (c + r) % 2 == 0
                    context.fill(Path(rect), with: .color(isA ? a : b))
                }
            }
            let border = CGRect(origin: .zero, size: size)
            context.stroke(Path(border), with: .color(FestivalDesign.navy.opacity(0.55)), lineWidth: 1)
        }
    }
}

// MARK: - Published wall

private struct PublishedWall: View {
    let items: [DiscoveryItem]

    var body: some View {
        ZStack {
            // Opaque pixel cork board. It intentionally sits on an empty
            // center wall strip so furniture and agents never hide behind it.
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(red: 0.78, green: 0.55, blue: 0.30))
                .overlay(PixelBoardDots().opacity(0.42))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(red: 0.28, green: 0.17, blue: 0.10), lineWidth: 3)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(red: 0.96, green: 0.75, blue: 0.38), lineWidth: 1)
                        .padding(4)
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("게시판")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(FestivalDesign.navy)
                    Spacer()
                    Text("\(items.count)건")
                        .font(.system(size: 8))
                        .foregroundStyle(FestivalDesign.navy.opacity(0.75))
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
        .background(FestivalDesign.surface)
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
