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
                OfficeFloorView(agents: viewModel.agents)
                    .aspectRatio(0.72, contentMode: .fit)
                summaryCard
                providerSection(title: "Parking Providers", providers: viewModel.snapshot.parkingProviders)
                providerSection(title: "Discovery Providers", providers: viewModel.snapshot.discoveryProviders)
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("Agent Office")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: refresh) {
                    Image(systemName: viewModel.isLoading ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                .accessibilityLabel("Refresh Agent Office")
            }
        }
        .task { await viewModel.runPolling() }
        .refreshable { await viewModel.refresh() }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Agent Office")
                    .font(.largeTitle.bold())
                    .foregroundStyle(FestivalDesign.navy)
                Text("Backend agents on the floor right now")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
            Spacer()
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Orion Summary", systemImage: "brain.head.profile")
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
                Text("No provider health returned.")
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
}

private extension AgentOfficeView {
    func refresh() {
        Task { await viewModel.refresh() }
    }
}

// MARK: - Office floor

private struct OfficeFloorView: View {
    let agents: [AgentOfficeAgent]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
            GeometryReader { proxy in
                let size = proxy.size
                let frames = currentFrames(date: timeline.date)
                let receivers = activeReceivers(frames: frames)

                ZStack {
                    OfficeBackdrop(agents: agents)

                    ForEach(agents) { agent in
                        let frame = frames[agent.id] ?? AgentFrame(position: agent.home, phase: .working, walking: false, facing: 0, progress: 0)
                        let isReceiving = receivers[agent.id]
                        let isSpeaking = frame.phase == .chatting && agent.visit != nil

                        AgentSprite(
                            agent: agent,
                            frame: frame,
                            speakingLine: lineToSpeak(for: agent, frame: frame, receiverInfo: isReceiving),
                            isSpeaking: isSpeaking || isReceiving != nil,
                            date: timeline.date
                        )
                        .position(
                            x: frame.position.x * size.width,
                            y: frame.position.y * size.height
                        )
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

    private func currentFrames(date: Date) -> [String: AgentFrame] {
        var result: [String: AgentFrame] = [:]
        for agent in agents {
            result[agent.id] = AgentChoreography.frame(for: agent, at: date)
        }
        return result
    }

    /// For each static partner agent, returns the visitor id (if any) currently chatting with them.
    private func activeReceivers(frames: [String: AgentFrame]) -> [String: String] {
        var receivers: [String: String] = [:]
        for agent in agents {
            guard let partnerID = agent.partnerID,
                  let frame = frames[agent.id],
                  frame.phase == .chatting else { continue }
            receivers[partnerID] = agent.id
        }
        return receivers
    }

    private func lineToSpeak(for agent: AgentOfficeAgent, frame: AgentFrame, receiverInfo: String?) -> String? {
        if frame.phase == .chatting && agent.visit != nil {
            return agent.line
        }
        if receiverInfo != nil {
            return agent.reply
        }
        return nil
    }
}

// MARK: - Backdrop (static furniture)

private struct OfficeBackdrop: View {
    let agents: [AgentOfficeAgent]

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height

            ZStack {
                // Floor
                LinearGradient(
                    colors: [
                        FestivalDesign.cream.opacity(0.42),
                        FestivalDesign.surface,
                        FestivalDesign.parkingSoft.opacity(0.45)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )

                // Subtle floor grid
                FloorGrid()
                    .stroke(FestivalDesign.creamDeep.opacity(0.18), lineWidth: 0.6)

                // Carpet bands behind desks
                CarpetBand(rect: CGRect(x: 0.08 * w, y: 0.30 * h, width: 0.84 * w, height: 0.18 * h),
                          color: FestivalDesign.tealSoft.opacity(0.55))
                CarpetBand(rect: CGRect(x: 0.08 * w, y: 0.66 * h, width: 0.84 * w, height: 0.26 * h),
                          color: FestivalDesign.parkingSoft.opacity(0.55))

                // Meeting room
                MeetingRoom(rect: CGRect(x: 0.26 * w, y: 0.04 * h, width: 0.50 * w, height: 0.24 * h))

                // Coffee corner (top-left)
                CoffeeCorner(center: CGPoint(x: 0.10 * w, y: 0.10 * h))

                // Plants
                Plant(center: CGPoint(x: 0.92 * w, y: 0.08 * h))
                Plant(center: CGPoint(x: 0.06 * w, y: 0.96 * h))
                Plant(center: CGPoint(x: 0.94 * w, y: 0.96 * h))

                // Desks for each non-Orion agent at their home
                ForEach(agents) { agent in
                    if agent.id != "orion" {
                        AgentDesk(home: agent.home, id: agent.id)
                            .position(x: agent.home.x * w, y: (agent.home.y + 0.03) * h)
                    }
                }

                // Dashed walking paths
                WalkingPaths(agents: agents)
                    .stroke(FestivalDesign.creamDeep.opacity(0.45),
                            style: StrokeStyle(lineWidth: 1, dash: [3, 5]))

                // Live label
                HStack(spacing: 5) {
                    Circle()
                        .fill(FestivalDesign.teal)
                        .frame(width: 6, height: 6)
                    Text("Live floor")
                        .font(.caption2.bold())
                        .foregroundStyle(FestivalDesign.navy)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(FestivalDesign.surface.opacity(0.92))
                .clipShape(Capsule())
                .overlay(Capsule().stroke(FestivalDesign.creamDeep.opacity(0.6), lineWidth: 0.5))
                .position(x: w - 56, y: 18)
            }
        }
    }
}

private struct FloorGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let step: CGFloat = 28
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

private struct CarpetBand: View {
    let rect: CGRect
    let color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(color)
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
    }
}

private struct MeetingRoom: View {
    let rect: CGRect

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(FestivalDesign.cream.opacity(0.85))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(FestivalDesign.creamDeep.opacity(0.85), lineWidth: 1.2)
                )
                .frame(width: rect.width, height: rect.height)
                .position(x: rect.midX, y: rect.midY)

            // Long table
            RoundedRectangle(cornerRadius: 4)
                .fill(FestivalDesign.creamDeep.opacity(0.85))
                .frame(width: rect.width * 0.62, height: rect.height * 0.30)
                .position(x: rect.midX, y: rect.midY + rect.height * 0.06)

            // Whiteboard hint at top
            RoundedRectangle(cornerRadius: 2)
                .fill(FestivalDesign.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(FestivalDesign.teal.opacity(0.5), lineWidth: 0.8)
                )
                .frame(width: rect.width * 0.34, height: 6)
                .position(x: rect.midX, y: rect.minY + 8)

            Text("MEETING")
                .font(.system(size: 8, weight: .semibold))
                .tracking(1)
                .foregroundStyle(FestivalDesign.secondaryText.opacity(0.7))
                .position(x: rect.midX, y: rect.maxY - 10)
        }
    }
}

private struct CoffeeCorner: View {
    let center: CGPoint

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(FestivalDesign.lantern.opacity(0.22))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(FestivalDesign.lantern.opacity(0.45), lineWidth: 0.8)
                )
                .frame(width: 42, height: 30)

            Image(systemName: "cup.and.saucer.fill")
                .font(.system(size: 12))
                .foregroundStyle(FestivalDesign.coral)
        }
        .position(center)
    }
}

private struct Plant: View {
    let center: CGPoint

    var body: some View {
        ZStack {
            Circle()
                .fill(FestivalDesign.teal.opacity(0.85))
                .frame(width: 14, height: 14)
            Circle()
                .fill(FestivalDesign.teal.opacity(0.55))
                .frame(width: 8, height: 8)
                .offset(x: -4, y: -4)
            Trapezoid()
                .fill(FestivalDesign.creamDeep)
                .frame(width: 12, height: 6)
                .offset(y: 9)
        }
        .position(center)
    }
}

private struct Trapezoid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.15, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.15, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

private struct AgentDesk: View {
    let home: CGPoint
    let id: String

    private var profile: AgentVisualProfile { AgentVisualProfile.profile(for: id) }

    var body: some View {
        ZStack {
            // Desk surface
            RoundedRectangle(cornerRadius: 4)
                .fill(profile.deskColor.opacity(0.88))
                .frame(width: 46, height: 22)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(FestivalDesign.navy.opacity(0.10), lineWidth: 0.8)
                )

            // Monitor
            RoundedRectangle(cornerRadius: 2)
                .fill(FestivalDesign.navy.opacity(0.85))
                .frame(width: 16, height: 11)
                .overlay(
                    Image(systemName: profile.symbol)
                        .font(.system(size: 6, weight: .bold))
                        .foregroundStyle(profile.characterColor)
                )
                .offset(y: -2)
        }
        .shadow(color: FestivalDesign.navy.opacity(0.08), radius: 3, y: 1.5)
    }
}

private struct WalkingPaths: Shape {
    let agents: [AgentOfficeAgent]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for agent in agents {
            guard let visit = agent.visit else { continue }
            path.move(to: CGPoint(x: agent.home.x * rect.width, y: agent.home.y * rect.height))
            path.addLine(to: CGPoint(x: visit.x * rect.width, y: visit.y * rect.height))
        }
        return path
    }
}

// MARK: - Agent sprite (moving character + bubble)

private struct AgentSprite: View {
    let agent: AgentOfficeAgent
    let frame: AgentFrame
    let speakingLine: String?
    let isSpeaking: Bool
    let date: Date

    private var profile: AgentVisualProfile { AgentVisualProfile.profile(for: agent.id) }

    private var walkBob: CGFloat {
        guard frame.walking else { return 0 }
        let t = date.timeIntervalSinceReferenceDate
        return CGFloat(sin(t * 9 + Double(agent.id.hashValue % 7))) * 1.4
    }

    private var idleBreath: CGFloat {
        guard !frame.walking else { return 1 }
        let t = date.timeIntervalSinceReferenceDate
        return 1 + CGFloat(sin(t * 1.6 + Double(agent.id.hashValue % 11))) * 0.03
    }

    var body: some View {
        ZStack {
            CharacterBody(
                bodyColor: profile.characterColor,
                statusColor: agent.status.color,
                facing: frame.facing,
                walking: frame.walking
            )
            .offset(y: walkBob)
            .scaleEffect(idleBreath)

            if isSpeaking, let line = speakingLine {
                SpeechBubble(text: line, accent: agent.status.color, speakerName: agent.name)
                    .offset(y: -34)
                    .transition(.opacity.combined(with: .scale(scale: 0.85, anchor: .bottom)))
            }

            Text(agent.name)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(FestivalDesign.surface.opacity(0.88))
                .clipShape(Capsule())
                .offset(y: 24)
        }
        .frame(width: 110, height: 32)
        .animation(.easeInOut(duration: 0.25), value: isSpeaking)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role), \(agent.status.title)\(speakingLine.map { ": \($0)" } ?? "")")
    }
}

private struct CharacterBody: View {
    let bodyColor: Color
    let statusColor: Color
    let facing: CGFloat
    let walking: Bool

    var body: some View {
        ZStack {
            // Shadow
            Ellipse()
                .fill(FestivalDesign.navy.opacity(0.16))
                .frame(width: 22, height: 6)
                .offset(y: 14)

            // Status ring
            Circle()
                .stroke(statusColor.opacity(0.85), lineWidth: 2)
                .frame(width: 26, height: 26)
                .offset(y: 2)

            // Body
            Circle()
                .fill(bodyColor.opacity(0.92))
                .frame(width: 22, height: 22)
                .offset(y: 2)

            // Head
            Circle()
                .fill(FestivalDesign.cream)
                .frame(width: 14, height: 14)
                .overlay(
                    Circle()
                        .stroke(bodyColor.opacity(0.65), lineWidth: 1.4)
                )
                .offset(x: facing * 1.5, y: -6)

            // Nose dot (facing indicator)
            Circle()
                .fill(FestivalDesign.navy.opacity(0.6))
                .frame(width: 2.4, height: 2.4)
                .offset(x: facing * 4.5, y: -6)

            // Status pip on shoulder
            Circle()
                .fill(statusColor)
                .frame(width: 5, height: 5)
                .overlay(Circle().stroke(FestivalDesign.surface, lineWidth: 1))
                .offset(x: 9, y: -2)
        }
        .frame(width: 32, height: 32)
    }
}

private struct SpeechBubble: View {
    let text: String
    let accent: Color
    let speakerName: String

    var body: some View {
        VStack(spacing: 1) {
            Text(speakerName.uppercased())
                .font(.system(size: 7, weight: .heavy))
                .tracking(0.6)
                .foregroundStyle(accent)
            Text(text)
                .font(.system(size: 9))
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .frame(maxWidth: 116)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(FestivalDesign.surface)
                BubbleTail()
                    .fill(FestivalDesign.surface)
                    .frame(width: 8, height: 5)
                    .offset(y: 18)
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(accent.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.10), radius: 4, y: 2)
    }
}

private struct BubbleTail: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Choreography helpers

private enum AgentPhase {
    case working
    case walkingOut
    case chatting
    case walkingBack
}

private struct AgentFrame {
    let position: CGPoint
    let phase: AgentPhase
    let walking: Bool
    let facing: CGFloat
    let progress: Double
}

private enum AgentChoreography {
    static let cycleSeconds: Double = 18

    static func frame(for agent: AgentOfficeAgent, at date: Date) -> AgentFrame {
        let t = date.timeIntervalSinceReferenceDate / cycleSeconds + agent.phaseOffset
        var tau = t.truncatingRemainder(dividingBy: 1)
        if tau < 0 { tau += 1 }

        guard let visit = agent.visit else {
            return AgentFrame(position: agent.home, phase: .working, walking: false, facing: 0, progress: tau)
        }

        let walkOutEnd = 0.22
        let chatEnd = 0.50
        let walkBackEnd = 0.72

        if tau < walkOutEnd {
            let p = easeInOut(tau / walkOutEnd)
            let pos = lerp(agent.home, visit, t: p)
            return AgentFrame(position: pos, phase: .walkingOut, walking: true,
                              facing: sign(visit.x - agent.home.x), progress: tau)
        } else if tau < chatEnd {
            return AgentFrame(position: visit, phase: .chatting, walking: false,
                              facing: sign(agent.home.x - visit.x), progress: tau)
        } else if tau < walkBackEnd {
            let p = easeInOut((tau - chatEnd) / (walkBackEnd - chatEnd))
            let pos = lerp(visit, agent.home, t: p)
            return AgentFrame(position: pos, phase: .walkingBack, walking: true,
                              facing: sign(agent.home.x - visit.x), progress: tau)
        } else {
            return AgentFrame(position: agent.home, phase: .working, walking: false, facing: 0, progress: tau)
        }
    }

    private static func easeInOut(_ x: Double) -> Double {
        let clamped = max(0, min(1, x))
        return clamped < 0.5
            ? 2 * clamped * clamped
            : 1 - pow(-2 * clamped + 2, 2) / 2
    }

    private static func lerp(_ a: CGPoint, _ b: CGPoint, t: Double) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * CGFloat(t),
                y: a.y + (b.y - a.y) * CGFloat(t))
    }

    private static func sign(_ value: CGFloat) -> CGFloat {
        if value > 0.01 { return 1 }
        if value < -0.01 { return -1 }
        return 0
    }
}

// MARK: - Agent profiles & provider row

private struct AgentVisualProfile {
    let symbol: String
    let characterColor: Color
    let deskColor: Color

    static func profile(for id: String) -> AgentVisualProfile {
        switch id {
        case "orion":
            return AgentVisualProfile(symbol: "sparkles", characterColor: FestivalDesign.coral, deskColor: FestivalDesign.cream)
        case "sentinel":
            return AgentVisualProfile(symbol: "heart.text.square", characterColor: FestivalDesign.teal, deskColor: FestivalDesign.tealSoft)
        case "festa":
            return AgentVisualProfile(symbol: "calendar", characterColor: FestivalDesign.lantern, deskColor: FestivalDesign.cream)
        case "scout":
            return AgentVisualProfile(symbol: "magnifyingglass", characterColor: FestivalDesign.parkingBlue, deskColor: FestivalDesign.parkingSoft)
        case "radar":
            return AgentVisualProfile(symbol: "dot.radiowaves.left.and.right", characterColor: FestivalDesign.teal, deskColor: FestivalDesign.tealSoft)
        case "vera":
            return AgentVisualProfile(symbol: "checkmark.seal", characterColor: FestivalDesign.lantern, deskColor: FestivalDesign.cream)
        case "pixel":
            return AgentVisualProfile(symbol: "photo", characterColor: FestivalDesign.coral, deskColor: FestivalDesign.parkingSoft)
        case "piper":
            return AgentVisualProfile(symbol: "paperplane", characterColor: FestivalDesign.parkingBlue, deskColor: FestivalDesign.cream)
        case "echo":
            return AgentVisualProfile(symbol: "quote.bubble", characterColor: FestivalDesign.teal, deskColor: FestivalDesign.tealSoft)
        case "promoter":
            return AgentVisualProfile(symbol: "megaphone", characterColor: FestivalDesign.coral, deskColor: FestivalDesign.cream)
        default:
            return AgentVisualProfile(symbol: "desktopcomputer", characterColor: FestivalDesign.secondaryText, deskColor: FestivalDesign.surface)
        }
    }
}

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
                Text(provider.lastError ?? "quality \(Int(provider.qualityScore * 100))%")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer()
            Text(provider.stale ? "stale" : provider.status)
                .font(.caption.bold())
                .foregroundStyle(color)
        }
        .padding(.vertical, 6)
    }
}

#Preview {
    NavigationStack {
        AgentOfficeView(apiClient: MockAPIClient())
    }
}
