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
                    .frame(height: 430)
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
                    OfficeGrid()
                    ForEach(agents) { agent in
                        AgentNode(agent: agent, date: timeline.date)
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

private struct OfficeGrid: View {
    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                let spacing: CGFloat = 32
                var path = Path()
                var x: CGFloat = 0
                while x <= size.width {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: size.height))
                    x += spacing
                }
                var y: CGFloat = 0
                while y <= size.height {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                    y += spacing
                }
                context.stroke(path, with: .color(FestivalDesign.creamDeep.opacity(0.32)), lineWidth: 1)
            }
            .background(
                LinearGradient(
                    colors: [FestivalDesign.surface, FestivalDesign.parkingSoft.opacity(0.45)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )

            Text("Live backend operations")
                .font(.caption.bold())
                .foregroundStyle(FestivalDesign.secondaryText)
                .padding(10)
                .frame(maxWidth: proxy.size.width, alignment: .leading)
        }
    }
}

private struct AgentNode: View {
    let agent: AgentOfficeAgent
    let date: Date

    private var movement: CGSize {
        let phase = date.timeIntervalSinceReferenceDate + Double(abs(agent.id.hashValue % 13))
        let active = agent.status != .idle
        return CGSize(
            width: active ? cos(phase * 1.7) * 5 : cos(phase * 0.8) * 2,
            height: active ? sin(phase * 1.3) * 4 : sin(phase * 0.6) * 1.5
        )
    }

    private var pulseScale: CGFloat {
        guard agent.status != .idle else { return 1 }
        let phase = date.timeIntervalSinceReferenceDate * 2.4
        return 1 + CGFloat((sin(phase) + 1) * 0.06)
    }

    var body: some View {
        VStack(spacing: 6) {
            Text(agent.thought)
                .font(.caption2)
                .foregroundStyle(FestivalDesign.navy)
                .lineLimit(3)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(width: 132)
                .background(FestivalDesign.surface)
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(agent.status.color.opacity(0.4), lineWidth: 1)
                )

            ZStack {
                Circle()
                    .fill(agent.status.color.opacity(0.18))
                    .frame(width: 56, height: 56)
                    .scaleEffect(pulseScale)
                Circle()
                    .fill(agent.status.color)
                    .frame(width: 34, height: 34)
                    .overlay(
                        Text(String(agent.name.prefix(1)))
                            .font(.headline.bold())
                            .foregroundStyle(.white)
                    )
            }

            VStack(spacing: 1) {
                Text(agent.name)
                    .font(.caption.bold())
                    .foregroundStyle(FestivalDesign.navy)
                Text(agent.status.title)
                    .font(.caption2)
                    .foregroundStyle(FestivalDesign.secondaryText)
            }
        }
        .offset(movement)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.name), \(agent.role), \(agent.status.title), \(agent.thought)")
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
