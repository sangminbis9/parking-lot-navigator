import SwiftUI

struct AgentOfficeView: View {
    @StateObject private var viewModel: AgentOfficeViewModel

    init(apiClient: APIClientProtocol) {
        _viewModel = StateObject(wrappedValue: AgentOfficeViewModel(apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                OfficeFloorView(agents: viewModel.agents, snapshot: viewModel.snapshot)
                    .aspectRatio(0.78, contentMode: .fit)
                summaryCard
                providerSection(title: "주차 제공자", providers: viewModel.snapshot.parkingProviders)
                providerSection(title: "탐색 제공자", providers: viewModel.snapshot.discoveryProviders)
                attribution
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("에이전트 오피스")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: refresh) {
                    Image(systemName: viewModel.isLoading ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                .accessibilityLabel("에이전트 오피스 새로고침")
            }
        }
        .task { await viewModel.runPolling() }
        .refreshable { await viewModel.refresh() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("에이전트 오피스")
                .font(.largeTitle.bold())
                .foregroundStyle(FestivalDesign.navy)
            Text("수집팀이 발견한 축제·이벤트를 총괄에게 보고하고, 검증 후 게시판에 올려요.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.secondaryText)
        }
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
                        let frame = OfficeChoreography.frame(for: agent.id, at: t, snapshot: snapshot)
                        AgentRunner(
                            agent: agent,
                            frame: frame,
                            spokenLine: OfficeChoreography.spokenLine(for: agent, frame: frame, snapshot: snapshot)
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

    static func frame(for id: String, at t: TimeInterval, snapshot: AgentOfficeSnapshot) -> AgentFrame {
        switch id {
        case "festa":
            return collectorFrame(id: id, t: t, offset: 0,
                                  carry: .festival,
                                  itemCount: snapshot.festivals.count)
        case "scout":
            return collectorFrame(id: id, t: t, offset: 12,
                                  carry: .event,
                                  itemCount: snapshot.events.count)
        case "orion":
            let home = homes["orion"]!
            let dir: PixelSprite.Direction = (Int(t) % 8 < 4) ? .down : .left
            return AgentFrame(position: home, direction: dir, walking: false, walkPhase: 1,
                              stage: .idle, carry: nil)
        case "vera":
            return validatorFrame(t: t)
        case "echo":
            return publisherFrame(t: t, hasItems: snapshot.published.count > 0)
        case "sentinel":
            return patrolFrame(t: t)
        default:
            let home = homes[id] ?? CGPoint(x: 0.5, y: 0.5)
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
            let pos = lerp(home, orionDesk, p)
            let dir: PixelSprite.Direction = orionDesk.x > home.x ? .right : .left
            return AgentFrame(position: pos, direction: dir, walking: true, walkPhase: walking3,
                              stage: .walkingOut, carry: carry)
        case 9..<13:
            let dir: PixelSprite.Direction = orionDesk.x > home.x ? .right : .left
            return AgentFrame(position: orionDesk, direction: dir, walking: false, walkPhase: 1,
                              stage: .reporting, carry: carry)
        case 13..<17:
            let p = ease((tau - 13) / 4)
            let pos = lerp(orionDesk, wall, p)
            return AgentFrame(position: pos, direction: .down, walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: carry)
        case 17..<19:
            return AgentFrame(position: wall, direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: carry)
        default:
            let p = ease((tau - 19) / 5)
            let pos = lerp(wall, home, p)
            let dir: PixelSprite.Direction = home.x < wall.x ? .left : .right
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
        let pos = lerp(home, target, p)
        let walking3 = Int(t * 4) % 3
        let walking = p > 0.05 && p < 0.95
        let dir: PixelSprite.Direction = (target.x > home.x) ? .right : .left
        return AgentFrame(position: pos, direction: dir, walking: walking, walkPhase: walking3,
                          stage: .validating, carry: nil)
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
            let pos = lerp(home, CGPoint(x: 0.62, y: 0.76), p)
            return AgentFrame(position: pos, direction: .left, walking: true, walkPhase: walking3,
                              stage: .walkingToWall, carry: nil)
        case 12..<14:
            return AgentFrame(position: CGPoint(x: 0.62, y: 0.76), direction: .up, walking: false, walkPhase: 1,
                              stage: .posting, carry: nil)
        default:
            let p = ease((tau - 14) / 2)
            let pos = lerp(CGPoint(x: 0.62, y: 0.76), home, p)
            return AgentFrame(position: pos, direction: .right, walking: true, walkPhase: walking3,
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

    private static func ease(_ x: Double) -> Double {
        let c = max(0, min(1, x))
        return c < 0.5 ? 2 * c * c : 1 - pow(-2 * c + 2, 2) / 2
    }

    private static func lerp(_ a: CGPoint, _ b: CGPoint, _ t: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * CGFloat(t),
                y: a.y + (b.y - a.y) * CGFloat(t))
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

// MARK: - Pixel backdrop

private struct PixelOfficeBackdrop: View {
    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            ZStack {
                // Floor: warm wooden gradient with subtle tile grid
                LinearGradient(
                    colors: [
                        FestivalDesign.cream.opacity(0.65),
                        FestivalDesign.surface,
                        FestivalDesign.parkingSoft.opacity(0.40)
                    ],
                    startPoint: .top, endPoint: .bottom
                )

                PixelTileGrid()
                    .stroke(FestivalDesign.creamDeep.opacity(0.22), lineWidth: 0.6)

                // Top wall (brick row)
                BrickStrip()
                    .fill(FestivalDesign.lantern.opacity(0.35))
                    .frame(height: 18)
                    .position(x: w / 2, y: 10)

                // Windows on top wall
                Window()
                    .frame(width: 36, height: 14)
                    .position(x: w * 0.30, y: 10)
                Window()
                    .frame(width: 36, height: 14)
                    .position(x: w * 0.68, y: 10)

                // Desks row (collector left/right + head center)
                PixelDesk(label: "축제팀", accent: FestivalDesign.lantern)
                    .position(x: w * 0.16, y: h * 0.50)
                PixelDesk(label: "총괄", accent: FestivalDesign.coral)
                    .position(x: w * 0.50, y: h * 0.42)
                PixelDesk(label: "이벤트팀", accent: FestivalDesign.parkingBlue)
                    .position(x: w * 0.84, y: h * 0.50)

                // Validation table (Vera)
                PixelDesk(label: "검증", accent: FestivalDesign.teal)
                    .position(x: w * 0.36, y: h * 0.30)

                // Echo's promo nook
                PixelDesk(label: "홍보", accent: FestivalDesign.coral.opacity(0.7))
                    .position(x: w * 0.80, y: h * 0.78)

                // Plants
                PixelPlant().position(x: w * 0.06, y: h * 0.06)
                PixelPlant().position(x: w * 0.94, y: h * 0.06)
                PixelPlant().position(x: w * 0.06, y: h * 0.62)

                // Patrol path hint
                Path { path in
                    path.move(to: CGPoint(x: w * 0.10, y: h * 0.16))
                    path.addLine(to: CGPoint(x: w * 0.90, y: h * 0.16))
                    path.addLine(to: CGPoint(x: w * 0.90, y: h * 0.62))
                    path.addLine(to: CGPoint(x: w * 0.10, y: h * 0.62))
                    path.closeSubpath()
                }
                .stroke(FestivalDesign.teal.opacity(0.30),
                        style: StrokeStyle(lineWidth: 1, dash: [3, 4]))

                // Live indicator
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

private struct PixelTileGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let step: CGFloat = 20
        var x = rect.minX
        while x <= rect.maxX {
            path.move(to: CGPoint(x: x, y: rect.minY))
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
            x += step
        }
        var y = rect.minY
        while y <= rect.maxY {
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
            y += step
        }
        return path
    }
}

private struct BrickStrip: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        let brickW: CGFloat = 18
        let brickH: CGFloat = 9
        var y = rect.minY
        var row = 0
        while y < rect.maxY {
            let offsetX = (row % 2 == 0) ? 0 : brickW / 2
            var x = rect.minX - brickW + offsetX
            while x < rect.maxX {
                path.move(to: CGPoint(x: x, y: y))
                path.addLine(to: CGPoint(x: x, y: y + brickH))
                x += brickW
            }
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
            y += brickH
            row += 1
        }
        return path
    }
}

private struct Window: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .fill(FestivalDesign.parkingSoft.opacity(0.7))
            HStack(spacing: 0) {
                Rectangle().fill(Color.clear)
                Rectangle().fill(FestivalDesign.creamDeep.opacity(0.8)).frame(width: 1)
                Rectangle().fill(Color.clear)
            }
            VStack(spacing: 0) {
                Rectangle().fill(Color.clear)
                Rectangle().fill(FestivalDesign.creamDeep.opacity(0.8)).frame(height: 1)
                Rectangle().fill(Color.clear)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(FestivalDesign.creamDeep, lineWidth: 1.2)
        )
    }
}

private struct PixelDesk: View {
    let label: String
    let accent: Color

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                RoundedRectangle(cornerRadius: 2)
                    .fill(FestivalDesign.creamDeep.opacity(0.85))
                    .frame(width: 44, height: 22)
                    .overlay(
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(FestivalDesign.navy.opacity(0.20), lineWidth: 0.8)
                    )
                RoundedRectangle(cornerRadius: 1)
                    .fill(FestivalDesign.navy.opacity(0.85))
                    .frame(width: 14, height: 9)
                    .overlay(
                        Rectangle()
                            .fill(accent.opacity(0.85))
                            .frame(width: 10, height: 6)
                    )
                    .offset(y: -2)
                RoundedRectangle(cornerRadius: 1)
                    .fill(accent.opacity(0.85))
                    .frame(width: 6, height: 8)
                    .offset(x: 14, y: 0)
            }
            Text(label)
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(FestivalDesign.navy.opacity(0.75))
        }
    }
}

private struct PixelPlant: View {
    var body: some View {
        VStack(spacing: -2) {
            ZStack {
                Circle().fill(FestivalDesign.teal.opacity(0.85)).frame(width: 14, height: 14)
                Circle().fill(FestivalDesign.teal.opacity(0.55)).frame(width: 8, height: 8).offset(x: -3, y: -3)
            }
            Trapezoid()
                .fill(FestivalDesign.creamDeep)
                .frame(width: 12, height: 8)
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
