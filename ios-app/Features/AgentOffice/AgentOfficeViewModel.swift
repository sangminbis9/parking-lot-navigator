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
        case .idle: return "대기"
        case .thinking: return "판단 중"
        case .collecting: return "수집 중"
        case .validating: return "검증 중"
        case .monitoring: return "감시 중"
        case .blocked: return "확인 필요"
        case .error: return "오류"
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

struct DiscoveryItem: Identifiable, Hashable {
    enum Kind: Hashable { case festival, event }
    let id: String
    let title: String
    let subtitle: String
    let kind: Kind
}

struct AgentOfficeSnapshot {
    let summary: String
    let parkingProviders: [ProviderHealth]
    let discoveryProviders: [ProviderHealth]
    let festivals: [DiscoveryItem]
    let events: [DiscoveryItem]
    let updatedAt: Date

    var published: [DiscoveryItem] {
        let merged = festivals.prefix(3) + events.prefix(3)
        return Array(merged.prefix(6))
    }

    static let empty = AgentOfficeSnapshot(
        summary: "백엔드 상태를 기다리는 중이에요.",
        parkingProviders: [],
        discoveryProviders: [],
        festivals: [],
        events: [],
        updatedAt: Date()
    )
}

struct AgentOfficeAgent: Identifiable {
    let id: String
    let name: String
    let role: String
    let spriteAsset: String
    let status: AgentOfficeStatus
    let line: String
    let reply: String
}

@MainActor
final class AgentOfficeViewModel: ObservableObject {
    @Published private(set) var agents: [AgentOfficeAgent] = []
    @Published private(set) var snapshot: AgentOfficeSnapshot = .empty
    @Published private(set) var isLoading = false
    @Published private(set) var recentActivity: [AgentActivityEvent] = []
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol
    private var hasLoaded = false
    private var lastActivityTimestamp: String?

    // Seoul City Hall — fixed reference point for the office display.
    private let referenceLat: Double = 37.5665
    private let referenceLng: Double = 126.9780
    private let referenceRadius: Int = 30_000

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        agents = Self.buildAgents(snapshot: .empty)
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

        async let parkingProviders = apiClient.providerHealth()
        async let discoveryProviders = apiClient.discoveryProviderHealth()
        async let festivalsResult: [Festival]? = try? apiClient.nearbyFestivals(lat: referenceLat, lng: referenceLng, radiusMeters: referenceRadius)
        async let eventsResult: [FreeEvent]? = try? apiClient.nearbyEvents(lat: referenceLat, lng: referenceLng, radiusMeters: referenceRadius)
        async let activityResult: [AgentActivityEvent]? = try? apiClient.agentActivity(since: nil, limit: 80)

        do {
            let parking = try await parkingProviders
            let discovery = try await discoveryProviders
            let fests = (await festivalsResult) ?? []
            let evts = (await eventsResult) ?? []
            let activity = (await activityResult) ?? []
            recentActivity = activity
            lastActivityTimestamp = activity.first?.ts ?? lastActivityTimestamp

            let normalizedFestivals = fests.prefix(8).map { f in
                DiscoveryItem(
                    id: "fest-\(f.id)",
                    title: f.title,
                    subtitle: f.venueName ?? f.address,
                    kind: .festival
                )
            }
            let normalizedEvents = evts.prefix(8).map { e in
                DiscoveryItem(
                    id: "evt-\(e.id)",
                    title: e.title,
                    subtitle: e.storeName,
                    kind: .event
                )
            }

            let nextSnapshot = AgentOfficeSnapshot(
                summary: Self.summary(parking: parking, discovery: discovery, festivals: normalizedFestivals.count, events: normalizedEvents.count),
                parkingProviders: parking,
                discoveryProviders: discovery,
                festivals: Array(normalizedFestivals),
                events: Array(normalizedEvents),
                updatedAt: Date()
            )
            snapshot = nextSnapshot
            agents = Self.buildAgents(snapshot: nextSnapshot)
        } catch {
            errorMessage = error.localizedDescription
            snapshot = AgentOfficeSnapshot(
                summary: "백엔드 연결 실패: \(error.localizedDescription)",
                parkingProviders: [],
                discoveryProviders: [],
                festivals: [],
                events: [],
                updatedAt: Date()
            )
            agents = Self.errorAgents(message: error.localizedDescription)
        }

        isLoading = false
    }

    // MARK: - Builders

    private static func summary(parking: [ProviderHealth], discovery: [ProviderHealth], festivals: Int, events: Int) -> String {
        let p = providerCounts(parking)
        let d = providerCounts(discovery)
        return "주차 \(p.up)/\(p.total) 정상 · 탐색 \(d.up)/\(d.total) 정상 · 오늘 발견 축제 \(festivals)건 이벤트 \(events)건"
    }

    private static func buildAgents(snapshot: AgentOfficeSnapshot) -> [AgentOfficeAgent] {
        let p = providerCounts(snapshot.parkingProviders)
        let d = providerCounts(snapshot.discoveryProviders)
        let stale = p.stale + d.stale
        let festivalCount = snapshot.festivals.count
        let eventCount = snapshot.events.count

        return [
            AgentOfficeAgent(
                id: "orion",
                name: "Orion",
                role: "총괄",
                spriteAsset: "AgentChar0",
                status: .thinking,
                line: snapshot.summary,
                reply: stale > 0 ? "지연 신호 \(stale)개 확인했어요." : "잘 진행 중이에요."
            ),
            AgentOfficeAgent(
                id: "festa",
                name: "Festa",
                role: "축제 수집",
                spriteAsset: "AgentChar1",
                status: festivalCount > 0 ? .collecting : .idle,
                line: festivalCount > 0 ? "축제 \(festivalCount)건 정리했어요." : "오늘은 새 축제가 없네요.",
                reply: "보고드릴게요."
            ),
            AgentOfficeAgent(
                id: "scout",
                name: "Scout",
                role: "이벤트 수집",
                spriteAsset: "AgentChar2",
                status: eventCount > 0 ? .collecting : .idle,
                line: eventCount > 0 ? "이벤트 \(eventCount)건 발견." : "현재 진행 이벤트 없음.",
                reply: "곧 가져갑니다."
            ),
            AgentOfficeAgent(
                id: "vera",
                name: "Vera",
                role: "검증",
                spriteAsset: "AgentChar3",
                status: validatorStatus(parking: p, discovery: d),
                line: "데이터 품질 확인 중.",
                reply: p.down + d.down > 0 ? "실패 항목 표시했어요." : "검증 통과 중이에요."
            ),
            AgentOfficeAgent(
                id: "sentinel",
                name: "Sentinel",
                role: "백엔드 감시",
                spriteAsset: "AgentChar4",
                status: healthStatus(for: p),
                line: p.total == 0
                    ? "주차 피드가 응답하지 않아요."
                    : "주차 \(p.up)/\(p.total) 정상\(p.stale > 0 ? ", 지연 \(p.stale)" : "").",
                reply: "패트롤 계속할게요."
            ),
            AgentOfficeAgent(
                id: "echo",
                name: "Echo",
                role: "게시 / 홍보",
                spriteAsset: "AgentChar5",
                status: .idle,
                line: "게시판 정리 중.",
                reply: "푸시 일정 잡아둘게요."
            )
        ]
    }

    private static func errorAgents(message: String) -> [AgentOfficeAgent] {
        let base = buildAgents(snapshot: .empty)
        return base.map { agent in
            switch agent.id {
            case "orion":
                return AgentOfficeAgent(id: agent.id, name: agent.name, role: agent.role, spriteAsset: agent.spriteAsset, status: .error, line: "백엔드에 연결할 수 없어요.", reply: message)
            case "sentinel":
                return AgentOfficeAgent(id: agent.id, name: agent.name, role: agent.role, spriteAsset: agent.spriteAsset, status: .blocked, line: "헬스 엔드포인트 응답 없음.", reply: "재시도 대기 중.")
            default:
                return AgentOfficeAgent(id: agent.id, name: agent.name, role: agent.role, spriteAsset: agent.spriteAsset, status: .idle, line: "백엔드 복구를 기다려요.", reply: "대기 중.")
            }
        }
    }

    // MARK: - Counts

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

    private static func healthStatus(for counts: ProviderCounts) -> AgentOfficeStatus {
        guard counts.total > 0 else { return .idle }
        if counts.down > 0 { return .error }
        if counts.stale > 0 { return .blocked }
        if counts.degraded > 0 { return .monitoring }
        return .monitoring
    }

    private static func validatorStatus(parking: ProviderCounts, discovery: ProviderCounts) -> AgentOfficeStatus {
        if parking.down + discovery.down > 0 { return .error }
        if parking.stale + discovery.stale > 0 { return .blocked }
        if parking.degraded + discovery.degraded > 0 { return .monitoring }
        return .validating
    }
}

private struct ProviderCounts {
    var up = 0
    var degraded = 0
    var down = 0
    var stale = 0
    var total: Int
}
