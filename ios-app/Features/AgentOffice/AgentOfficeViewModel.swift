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
    let thought: String
    let position: CGPoint
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
        agents = Self.agents(status: .idle, thought: "Ready to connect to the app backend.")
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
        agents = Self.loadingAgents()

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
        return "Parking providers \(parking.up)/\(parking.total) up, discovery providers \(discovery.up)/\(discovery.total) up."
    }

    private static func agents(for snapshot: AgentOfficeSnapshot) -> [AgentOfficeAgent] {
        let parkingCounts = providerCounts(snapshot.parkingProviders)
        let discoveryCounts = providerCounts(snapshot.discoveryProviders)
        let festivalProviders = snapshot.discoveryProviders.filter(isFestivalProvider)
        let eventProviders = snapshot.discoveryProviders.filter { !isFestivalProvider($0) }
        let festivalCounts = providerCounts(festivalProviders)
        let eventCounts = providerCounts(eventProviders)
        let staleCount = parkingCounts.stale + discoveryCounts.stale

        return [
            AgentOfficeAgent(id: "orion", name: "Orion", role: "Head Agent", status: .thinking, thought: snapshot.summary, position: CGPoint(x: 0.52, y: 0.16)),
            AgentOfficeAgent(id: "sentinel", name: "Sentinel", role: "Health Monitor", status: healthStatus(for: parkingCounts), thought: "Parking providers: \(parkingCounts.up)/\(parkingCounts.total) up.", position: CGPoint(x: 0.78, y: 0.31)),
            AgentOfficeAgent(id: "festa", name: "Festa", role: "Festival Collector", status: collectorStatus(for: festivalCounts), thought: "Festival sources: \(festivalCounts.up)/\(festivalCounts.total) up.", position: CGPoint(x: 0.22, y: 0.27)),
            AgentOfficeAgent(id: "scout", name: "Scout", role: "Event Collector", status: collectorStatus(for: eventCounts), thought: "Local event sources: \(eventCounts.up)/\(eventCounts.total) up.", position: CGPoint(x: 0.40, y: 0.34)),
            AgentOfficeAgent(id: "radar", name: "Radar", role: "Source Discovery", status: staleCount > 0 ? .blocked : .monitoring, thought: staleCount > 0 ? "\(staleCount) stale provider signals detected." : "Source policy signals are current.", position: CGPoint(x: 0.66, y: 0.53)),
            AgentOfficeAgent(id: "vera", name: "Vera", role: "Data Validator", status: validatorStatus(parkingCounts: parkingCounts, discoveryCounts: discoveryCounts), thought: "Validating backend response quality.", position: CGPoint(x: 0.20, y: 0.60)),
            AgentOfficeAgent(id: "pixel", name: "Pixel", role: "Image Enrichment", status: .idle, thought: "Image metadata is read from app content APIs.", position: CGPoint(x: 0.44, y: 0.68)),
            AgentOfficeAgent(id: "piper", name: "Piper", role: "Publisher", status: .idle, thought: "Publishing remains controlled by the app backend.", position: CGPoint(x: 0.70, y: 0.72)),
            AgentOfficeAgent(id: "echo", name: "Echo", role: "Feedback", status: .idle, thought: "User reports route through backend APIs.", position: CGPoint(x: 0.30, y: 0.86)),
            AgentOfficeAgent(id: "promoter", name: "Promoter", role: "Promotion", status: .idle, thought: "Sponsored local events stay separate.", position: CGPoint(x: 0.62, y: 0.88))
        ]
    }

    private static func agents(status: AgentOfficeStatus, thought: String) -> [AgentOfficeAgent] {
        agentSpecs.map {
            AgentOfficeAgent(id: $0.id, name: $0.name, role: $0.role, status: status, thought: thought, position: $0.position)
        }
    }

    private static func loadingAgents() -> [AgentOfficeAgent] {
        agentSpecs.map {
            AgentOfficeAgent(id: $0.id, name: $0.name, role: $0.role, status: $0.loadingStatus, thought: "Polling Parking_Lot_Navigator backend.", position: $0.position)
        }
    }

    private static func errorAgents(message: String) -> [AgentOfficeAgent] {
        agentSpecs.map { spec in
            let status: AgentOfficeStatus
            let thought: String

            switch spec.id {
            case "orion":
                status = .error
                thought = message
            case "sentinel":
                status = .blocked
                thought = "Cannot reach backend health endpoints."
            default:
                status = .idle
                thought = "Waiting for backend health to recover."
            }

            return AgentOfficeAgent(id: spec.id, name: spec.name, role: spec.role, status: status, thought: thought, position: spec.position)
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
            case "up":
                counts.up += 1
            case "degraded":
                counts.degraded += 1
            case "down":
                counts.down += 1
            case "stale":
                counts.stale += 1
            default:
                counts.degraded += 1
            }
        }
    }

    private static func normalizedStatus(_ provider: ProviderHealth) -> String {
        if provider.stale || provider.status.lowercased() == "stale" {
            return "stale"
        }
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

private struct AgentOfficeSpec {
    let id: String
    let name: String
    let role: String
    let loadingStatus: AgentOfficeStatus
    let position: CGPoint
}

private let agentSpecs: [AgentOfficeSpec] = [
    AgentOfficeSpec(id: "orion", name: "Orion", role: "Head Agent", loadingStatus: .thinking, position: CGPoint(x: 0.52, y: 0.16)),
    AgentOfficeSpec(id: "sentinel", name: "Sentinel", role: "Health Monitor", loadingStatus: .monitoring, position: CGPoint(x: 0.78, y: 0.31)),
    AgentOfficeSpec(id: "festa", name: "Festa", role: "Festival Collector", loadingStatus: .collecting, position: CGPoint(x: 0.22, y: 0.27)),
    AgentOfficeSpec(id: "scout", name: "Scout", role: "Event Collector", loadingStatus: .collecting, position: CGPoint(x: 0.40, y: 0.34)),
    AgentOfficeSpec(id: "radar", name: "Radar", role: "Source Discovery", loadingStatus: .monitoring, position: CGPoint(x: 0.66, y: 0.53)),
    AgentOfficeSpec(id: "vera", name: "Vera", role: "Data Validator", loadingStatus: .validating, position: CGPoint(x: 0.20, y: 0.60)),
    AgentOfficeSpec(id: "pixel", name: "Pixel", role: "Image Enrichment", loadingStatus: .idle, position: CGPoint(x: 0.44, y: 0.68)),
    AgentOfficeSpec(id: "piper", name: "Piper", role: "Publisher", loadingStatus: .idle, position: CGPoint(x: 0.70, y: 0.72)),
    AgentOfficeSpec(id: "echo", name: "Echo", role: "Feedback", loadingStatus: .idle, position: CGPoint(x: 0.30, y: 0.86)),
    AgentOfficeSpec(id: "promoter", name: "Promoter", role: "Promotion", loadingStatus: .idle, position: CGPoint(x: 0.62, y: 0.88))
]
