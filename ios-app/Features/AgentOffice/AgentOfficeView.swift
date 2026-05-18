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
                AgentOfficeFloorView(agents: viewModel.agents)
                    .frame(height: 560)
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
        .refreshable {
            await viewModel.refresh()
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Agent Office")
                    .font(.largeTitle.bold())
                    .foregroundStyle(FestivalDesign.navy)
                Text("Parking_Lot_Navigator backend status drives these agents.")
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

private struct AgentOfficeFloorView: View {
    let agents: [AgentOfficeAgent]

    var body: some View {
        TimelineView(.animation) { timeline in
            GeometryReader { proxy in
                ZStack {
                    OfficeBackdrop()
                    ForEach(agents) { agent in
                        AgentDesk(agent: agent, date: timeline.date)
                            .position(
                                x: proxy.size.width * agent.position.x,
                                y: proxy.size.height * agent.position.y
                            )
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                        .stroke(FestivalDesign.creamDeep.opacity(0.55), lineWidth: 1)
                )
            }
        }
    }
}

private struct OfficeBackdrop: View {
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    colors: [
                        FestivalDesign.cream.opacity(0.68),
                        FestivalDesign.surface,
                        FestivalDesign.parkingSoft.opacity(0.64)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                VStack(spacing: 0) {
                    Rectangle()
                        .fill(FestivalDesign.tealSoft.opacity(0.65))
                        .frame(height: proxy.size.height * 0.24)
                    Rectangle()
                        .fill(FestivalDesign.surface.opacity(0.3))
                        .frame(height: 1)
                    Spacer()
                    Rectangle()
                        .fill(FestivalDesign.creamDeep.opacity(0.36))
                        .frame(height: proxy.size.height * 0.18)
                }

                HStack(spacing: 10) {
                    OfficeWindow(color: FestivalDesign.parkingBlue)
                    OfficeWindow(color: FestivalDesign.teal)
                    OfficeWindow(color: FestivalDesign.coral)
                }
                .padding(.top, 18)
                .padding(.leading, 18)

                Label("Live backend operations", systemImage: "building.2.crop.circle")
                    .font(.caption.bold())
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(FestivalDesign.surface.opacity(0.86))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                    .padding(.top, 18)
                    .frame(maxWidth: proxy.size.width - 18, alignment: .trailing)

                OfficePath()
                    .stroke(FestivalDesign.creamDeep.opacity(0.55), style: StrokeStyle(lineWidth: 1.2, dash: [5, 8]))
                    .padding(.horizontal, 22)
                    .padding(.top, proxy.size.height * 0.28)
            }
        }
    }
}

private struct OfficeWindow: View {
    let color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(color.opacity(0.15))
            .frame(width: 44, height: 52)
            .overlay(
                VStack(spacing: 0) {
                    Rectangle().fill(FestivalDesign.surface.opacity(0.8)).frame(height: 1)
                    Spacer()
                    Rectangle().fill(FestivalDesign.surface.opacity(0.8)).frame(height: 1)
                }
                .padding(.vertical, 17)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(color.opacity(0.3), lineWidth: 1)
            )
    }
}

private struct OfficePath: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY * 0.25))
        path.addCurve(
            to: CGPoint(x: rect.maxX, y: rect.maxY * 0.78),
            control1: CGPoint(x: rect.width * 0.28, y: rect.minY),
            control2: CGPoint(x: rect.width * 0.58, y: rect.maxY)
        )
        return path
    }
}

private struct AgentDesk: View {
    let agent: AgentOfficeAgent
    let date: Date

    private var profile: AgentVisualProfile {
        AgentVisualProfile.profile(for: agent.id)
    }

    private var movement: CGSize {
        let phase = date.timeIntervalSinceReferenceDate + Double(abs(agent.id.hashValue % 13))
        let active = agent.status != .idle
        return CGSize(
            width: active ? cos(phase * 1.4) * 3 : cos(phase * 0.8) * 1.4,
            height: active ? sin(phase * 1.1) * 2.5 : sin(phase * 0.6) * 1.2
        )
    }

    private var pulseScale: CGFloat {
        guard agent.status != .idle else { return 1 }
        let phase = date.timeIntervalSinceReferenceDate * 2.4
        return 1 + CGFloat((sin(phase) + 1) * 0.06)
    }

    var body: some View {
        VStack(spacing: 5) {
            SpeechBubble(text: agent.thought, color: agent.status.color)

            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 7)
                    .fill(profile.deskColor.opacity(0.82))
                    .frame(width: 116, height: 52)
                    .overlay(
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(FestivalDesign.navy.opacity(0.08), lineWidth: 1)
                    )
                    .shadow(color: FestivalDesign.navy.opacity(0.1), radius: 7, y: 4)

                HStack(alignment: .bottom, spacing: 6) {
                    AgentCharacter(agent: agent, color: profile.characterColor, date: date)
                        .scaleEffect(pulseScale)
                    WorkstationSymbol(symbol: profile.symbol, statusColor: agent.status.color)
                }
                .padding(.bottom, 12)

                StatusLight(color: agent.status.color, active: agent.status != .idle, date: date)
                    .offset(x: 44, y: -36)
            }

            VStack(spacing: 1) {
                Text(agent.name)
                    .font(.caption.bold())
                    .foregroundStyle(FestivalDesign.navy)
                Text(agent.role)
                    .font(.caption2)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(1)
                Text(agent.status.title)
                    .font(.caption2.bold())
                    .foregroundStyle(agent.status.color)
            }
            .frame(width: 136)
        }
        .offset(movement)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role), \(agent.status.title), \(agent.thought)")
    }
}

private struct SpeechBubble: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(FestivalDesign.navy)
            .lineLimit(3)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(minWidth: 134, maxWidth: 134, minHeight: 44)
            .background(FestivalDesign.surface.opacity(0.94))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(color.opacity(0.36), lineWidth: 1)
            )
    }
}

private struct AgentCharacter: View {
    let agent: AgentOfficeAgent
    let color: Color
    let date: Date

    private var armOffset: CGFloat {
        guard agent.status != .idle else { return 0 }
        return CGFloat(sin(date.timeIntervalSinceReferenceDate * 5 + Double(agent.id.count))) * 2
    }

    var body: some View {
        ZStack {
            Capsule()
                .fill(color.opacity(0.9))
                .frame(width: 36, height: 42)
                .offset(y: 16)

            Circle()
                .fill(FestivalDesign.cream)
                .frame(width: 34, height: 34)
                .overlay(
                    Circle()
                        .stroke(color.opacity(0.42), lineWidth: 2)
                )

            ZStack {
                Circle()
                    .fill(FestivalDesign.navy)
                    .frame(width: 3, height: 3)
                    .offset(x: -6, y: -1)
                Circle()
                    .fill(FestivalDesign.navy)
                    .frame(width: 3, height: 3)
                    .offset(x: 6, y: -1)
                Capsule()
                    .fill(color)
                    .frame(width: 12, height: 3)
                    .offset(y: 8)
            }

            Capsule()
                .fill(color.opacity(0.82))
                .frame(width: 8, height: 24)
                .rotationEffect(.degrees(-26))
                .offset(x: -23, y: 22 + armOffset)

            Capsule()
                .fill(color.opacity(0.82))
                .frame(width: 8, height: 24)
                .rotationEffect(.degrees(26))
                .offset(x: 23, y: 22 - armOffset)
        }
        .frame(width: 54, height: 76)
    }
}

private struct WorkstationSymbol: View {
    let symbol: String
    let statusColor: Color

    var body: some View {
        VStack(spacing: 3) {
            RoundedRectangle(cornerRadius: 5)
                .fill(FestivalDesign.navy.opacity(0.9))
                .frame(width: 38, height: 28)
                .overlay(
                    Image(systemName: symbol)
                        .font(.caption.bold())
                        .foregroundStyle(statusColor)
                )
            RoundedRectangle(cornerRadius: 2)
                .fill(FestivalDesign.navy.opacity(0.55))
                .frame(width: 20, height: 4)
        }
    }
}

private struct StatusLight: View {
    let color: Color
    let active: Bool
    let date: Date

    private var opacity: Double {
        guard active else { return 0.42 }
        return 0.55 + (sin(date.timeIntervalSinceReferenceDate * 3) + 1) * 0.2
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 13, height: 13)
            .opacity(opacity)
            .overlay(
                Circle()
                    .stroke(FestivalDesign.surface, lineWidth: 2)
            )
    }
}

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

private extension AgentOfficeView {
    func refresh() {
        Task { await viewModel.refresh() }
    }
}

#Preview {
    NavigationStack {
        AgentOfficeView(apiClient: MockAPIClient())
    }
}
