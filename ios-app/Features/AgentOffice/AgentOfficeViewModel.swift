import Foundation
import SwiftUI

enum AgentOfficeStatus: String, Hashable {
    case idle
    case thinking
    case collecting
    case validating
    case monitoring
    case blocked
    case error

    var title: String {
        switch self {
        case .idle: return "Idle"
        case .thinking: return "Thinking"
        case .collecting: return "Collecting"
        case .validating: return "Validating"
        case .monitoring: return "Monitoring"
        case .blocked: return "Blocked"
        case .error: return "Error"
        }
    }

    var color: Color {
        switch self {
        case .idle: return FestivalDesign.secondaryText.opacity(0.7)
        case .thinking: return Color.purple
        case .collecting: return FestivalDesign.parkingBlue
        case .validating: return FestivalDesign.lantern
        case .monitoring: return FestivalDesign.teal
        case .blocked: return Color.orange
        case .error: return FestivalDesign.coral
        }
    }
}

struct AgentOfficeAgent: Identifiable {
    let id: String
    let name: String
    let role: String
    let status: AgentOfficeStatus
    /// What this agent says when they speak (used when they visit a partner).
    let line: String
    /// What this agent says when receiving a visitor.
    let reply: String
    /// Desk position in normalized 0..1 coordinates.
    let home: CGPoint
    /// Where the agent walks to during a cycle. `nil` means the agent stays at their desk.
    let visit: CGPoint?
    /// Who this agent is talking to when they visit.
    let partnerID: String?
    /// Offset (0..1) into the shared activity cycle so movers don't all walk at once.
    let phaseOffset: Double
}

struct AgentOfficeSnapshot {
    let summary: String
    let parkingProviders: [ProviderHealth]
    let discoveryProviders: [ProviderHealth]
    let updatedAt: Date

    static let empty = AgentOfficeSnapshot(
        summary: "Waiting for backend status.",
        parkingProviders: [],
        discoveryProviders: [],
        updatedAt: Date()
    )
}

@MainActor
final class AgentOfficeViewModel: ObservableObject {
    @Published private(set) var agents: [AgentOfficeAgent] = []
    @Published private(set) var snapshot: AgentOfficeSnapshot = .empty
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private var hasLoaded = false

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        agents = Self.idleAgents(line: "Ready to sync with backend.", reply: "Standing by.")
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        await refresh()
    }

    func runPolling() async {
        await loadIfNeeded()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil

        do {
            async let parkingProviders = apiClient.providerHealth()
            async let discoveryProviders = apiClient.discoveryProviderHealth()
            let parking = try await parkingProviders
            let discovery = try await discoveryProviders
            let nextSnapshot = AgentOfficeSnapshot(
                summary: Self.summary(parkingProviders: parking, discoveryProviders: discovery),
                parkingProviders: parking,
                discoveryProviders: discovery,
                updatedAt: Date()
            )
            snapshot = nextSnapshot
            agents = Self.agents(for: nextSnapshot)
        } catch {
            errorMessage = error.localizedDescription
            snapshot = AgentOfficeSnapshot(
                summary: "Backend connection failed: \(error.localizedDescription)",
                parkingProviders: [],
                discoveryProviders: [],
                updatedAt: Date()
            )
            agents = Self.errorAgents(message: error.localizedDescription)
        }

        isLoading = false
    }

    private static func summary(parkingProviders: [ProviderHealth], discoveryProviders: [ProviderHealth]) -> String {
        let parking = providerCounts(parkingProviders)
        let discovery = providerCounts(discoveryProviders)
        return "Parking \(parking.up)/\(parking.total) up · Discovery \(discovery.up)/\(discovery.total) up"
    }

    private static func agents(for snapshot: AgentOfficeSnapshot) -> [AgentOfficeAgent] {
        let parking = providerCounts(snapshot.parkingProviders)
        let discovery = providerCounts(snapshot.discoveryProviders)
        let festivalProviders = snapshot.discoveryProviders.filter(isFestivalProvider)
        let eventProviders = snapshot.discoveryProviders.filter { !isFestivalProvider($0) }
        let festival = providerCounts(festivalProviders)
        let events = providerCounts(eventProviders)
        let stale = parking.stale + discovery.stale

        return agentRoutes.map { route in
            switch route.id {
            case "orion":
                return route.build(
                    status: .thinking,
                    line: "Stand-up: \(snapshot.summary).",
                    reply: stale > 0 ? "Note \(stale) stale signals." : "Logging it. Keep going."
                )
            case "sentinel":
                return route.build(
                    status: healthStatus(for: parking),
                    line: parking.total == 0
                        ? "Parking feeds offline."
                        : "Parking \(parking.up)/\(parking.total) up\(parking.stale > 0 ? ", \(parking.stale) stale" : "").",
                    reply: parking.down > 0 ? "Pinging Radar for backups." : "Routes look healthy."
                )
            case "festa":
                return route.build(
                    status: collectorStatus(for: festival),
                    line: festival.total == 0
                        ? "No festival feed today."
                        : "Festivals \(festival.up)/\(festival.total) collected.",
                    reply: "Filing the brief."
                )
            case "scout":
                return route.build(
                    status: collectorStatus(for: events),
                    line: events.total == 0
                        ? "No event sources online."
                        : "Local events \(events.up)/\(events.total) ingested.",
                    reply: "Batch is on its way."
                )
            case "radar":
                return route.build(
                    status: stale > 0 ? .blocked : .monitoring,
                    line: stale > 0 ? "\(stale) stale source(s) flagged." : "All sources current.",
                    reply: "Tracking the gaps."
                )
            case "vera":
                return route.build(
                    status: validatorStatus(parkingCounts: parking, discoveryCounts: discovery),
                    line: "Running quality checks.",
                    reply: parking.down + discovery.down > 0 ? "Flagging failed rows." : "Checks passing."
                )
            case "pixel":
                return route.build(
                    status: .idle,
                    line: "Image sweep complete.",
                    reply: "Thumbnails attached."
                )
            case "piper":
                return route.build(
                    status: .idle,
                    line: "Publish queue is ready.",
                    reply: "Queued for publish."
                )
            case "echo":
                return route.build(
                    status: .idle,
                    line: "Compiling user reports.",
                    reply: "I'll forward the highlights."
                )
            case "promoter":
                return route.build(
                    status: .idle,
                    line: "Sponsored slots are clean.",
                    reply: "Bundle locked, thanks."
                )
            default:
                return route.build(status: .idle, line: "", reply: "")
            }
        }
    }

    private static func idleAgents(line: String, reply: String) -> [AgentOfficeAgent] {
        agentRoutes.map { $0.build(status: .idle, line: line, reply: reply) }
    }

    private static func errorAgents(message: String) -> [AgentOfficeAgent] {
        agentRoutes.map { route in
            switch route.id {
            case "orion":
                return route.build(status: .error, line: "Backend unreachable.", reply: message)
            case "sentinel":
                return route.build(status: .blocked, line: "Health endpoints down.", reply: "Holding the line.")
            default:
                return route.build(status: .idle, line: "Waiting for backend.", reply: "Standing by.")
            }
        }
    }

    private static func healthStatus(for counts: ProviderCounts) -> AgentOfficeStatus {
        guard counts.total > 0 else { return .idle }
        if counts.down > 0 { return .error }
        if counts.stale > 0 { return .blocked }
        if counts.degraded > 0 { return .monitoring }
        return .monitoring
    }

    private static func collectorStatus(for counts: ProviderCounts) -> AgentOfficeStatus {
        guard counts.total > 0 else { return .idle }
        if counts.down > 0 { return .error }
        if counts.stale > 0 || counts.degraded > 0 { return .blocked }
        return .collecting
    }

    private static func validatorStatus(parkingCounts: ProviderCounts, discoveryCounts: ProviderCounts) -> AgentOfficeStatus {
        if parkingCounts.down + discoveryCounts.down > 0 { return .error }
        if parkingCounts.stale + discoveryCounts.stale > 0 { return .blocked }
        if parkingCounts.degraded + discoveryCounts.degraded > 0 { return .monitoring }
        return .validating
    }

    private static func providerCounts(_ providers: [ProviderHealth]) -> ProviderCounts {
        providers.reduce(into: ProviderCounts(total: providers.count)) { counts, provider in
            switch normalizedStatus(provider) {
            case "up": counts.up += 1
            case "degraded": counts.degraded += 1
            case "down": counts.down += 1
            case "stale": counts.stale += 1
            default: counts.degraded += 1
            }
        }
    }

    private static func normalizedStatus(_ provider: ProviderHealth) -> String {
        if provider.stale || provider.status.lowercased() == "stale" { return "stale" }
        return provider.status.lowercased()
    }

    private static func isFestivalProvider(_ provider: ProviderHealth) -> Bool {
        let name = provider.name.lowercased()
        return name.contains("festival") || name.contains("tour") || name.contains("national")
    }
}

private struct ProviderCounts {
    var up = 0
    var degraded = 0
    var down = 0
    var stale = 0
    var total: Int
}

private struct AgentRoute {
    let id: String
    let name: String
    let role: String
    let home: CGPoint
    let visit: CGPoint?
    let partnerID: String?
    let phaseOffset: Double

    func build(status: AgentOfficeStatus, line: String, reply: String) -> AgentOfficeAgent {
        AgentOfficeAgent(
            id: id,
            name: name,
            role: role,
            status: status,
            line: line,
            reply: reply,
            home: home,
            visit: visit,
            partnerID: partnerID,
            phaseOffset: phaseOffset
        )
    }
}

// Top-down office choreography. Movers periodically walk to a partner's
// area, exchange one line, then return to their own desk. Phase offsets
// stagger the trips so the office always feels active without crowding.
private let agentRoutes: [AgentRoute] = [
    AgentRoute(
        id: "orion", name: "Orion", role: "Head Agent",
        home: CGPoint(x: 0.50, y: 0.14),
        visit: nil, partnerID: nil, phaseOffset: 0
    ),
    AgentRoute(
        id: "sentinel", name: "Sentinel", role: "Health Monitor",
        home: CGPoint(x: 0.85, y: 0.34),
        visit: CGPoint(x: 0.58, y: 0.20),
        partnerID: "orion", phaseOffset: 0.05
    ),
    AgentRoute(
        id: "festa", name: "Festa", role: "Festival Collector",
        home: CGPoint(x: 0.15, y: 0.34),
        visit: CGPoint(x: 0.42, y: 0.20),
        partnerID: "orion", phaseOffset: 0.32
    ),
    AgentRoute(
        id: "scout", name: "Scout", role: "Event Collector",
        home: CGPoint(x: 0.22, y: 0.50),
        visit: CGPoint(x: 0.43, y: 0.58),
        partnerID: "vera", phaseOffset: 0.58
    ),
    AgentRoute(
        id: "vera", name: "Vera", role: "Data Validator",
        home: CGPoint(x: 0.52, y: 0.58),
        visit: nil, partnerID: nil, phaseOffset: 0
    ),
    AgentRoute(
        id: "radar", name: "Radar", role: "Source Discovery",
        home: CGPoint(x: 0.82, y: 0.50),
        visit: CGPoint(x: 0.82, y: 0.40),
        partnerID: "sentinel", phaseOffset: 0.20
    ),
    AgentRoute(
        id: "pixel", name: "Pixel", role: "Image Enrichment",
        home: CGPoint(x: 0.20, y: 0.74),
        visit: CGPoint(x: 0.68, y: 0.74),
        partnerID: "piper", phaseOffset: 0.45
    ),
    AgentRoute(
        id: "piper", name: "Piper", role: "Publisher",
        home: CGPoint(x: 0.80, y: 0.74),
        visit: nil, partnerID: nil, phaseOffset: 0
    ),
    AgentRoute(
        id: "echo", name: "Echo", role: "Feedback",
        home: CGPoint(x: 0.28, y: 0.88),
        visit: CGPoint(x: 0.60, y: 0.88),
        partnerID: "promoter", phaseOffset: 0.78
    ),
    AgentRoute(
        id: "promoter", name: "Promoter", role: "Promotion",
        home: CGPoint(x: 0.74, y: 0.88),
        visit: nil, partnerID: nil, phaseOffset: 0
    )
]
