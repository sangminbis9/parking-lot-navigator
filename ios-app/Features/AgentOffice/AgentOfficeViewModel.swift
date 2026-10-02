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
    let hasImage: Bool
}

struct AgentOfficeSnapshot {
    let summary: String
    let parkingProviders: [ProviderHealth]
    let discoveryProviders: [ProviderHealth]
    let festivals: [DiscoveryItem]
    let events: [DiscoveryItem]
    let merchantEventCount: Int
    let updatedAt: Date

    var published: [DiscoveryItem] {
        let merged = festivals.prefix(3) + events.prefix(3)
        return Array(merged.prefix(6))
    }

    var missingImageCount: Int {
        festivals.filter { !$0.hasImage }.count + events.filter { !$0.hasImage }.count
    }

    static let empty = AgentOfficeSnapshot(
        summary: "백엔드 상태를 기다리는 중이에요.",
        parkingProviders: [],
        discoveryProviders: [],
        festivals: [],
        events: [],
        merchantEventCount: 0,
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

    var usesGeneratedPortrait: Bool {
        true
    }

    static func displayName(forID id: String) -> String {
        switch id {
        case "orion": return "총괄이"
        case "festa": return "축제맨"
        case "scout": return "행사맨"
        case "vera": return "검증이"
        case "pixel": return "사진이"
        case "sentinel": return "주차맨"
        case "echo": return "게시알"
        case "atlas": return "스냅이"
        case "harbor": return "가게알"
        case "relay": return "전달이"
        default: return id.uppercased()
        }
    }
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
        if hasLoaded {
            await refresh()
        } else {
            await loadIfNeeded()
        }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            guard !Task.isCancelled else { return }
            await refresh()
        }
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil

        async let parkingProviders = apiClient.providerHealth()
        async let discoveryProviders = apiClient.discoveryProviderHealth()
        async let festivalsResult: [Festival]? = try? apiClient.nearbyFestivals(lat: referenceLat, lng: referenceLng, radiusMeters: referenceRadius, upcomingWithinDays: 365)
        async let eventsResult: [FreeEvent]? = try? apiClient.nearbyEvents(lat: referenceLat, lng: referenceLng, radiusMeters: referenceRadius)
        let activitySince = lastActivityTimestamp
        async let activityResult: [AgentActivityEvent]? = try? apiClient.agentActivity(
            since: activitySince,
            limit: activitySince == nil ? 80 : 30
        )

        do {
            let parking = try await parkingProviders
            let discovery = try await discoveryProviders
            let fests = (await festivalsResult) ?? []
            let evts = (await eventsResult) ?? []
            let merchantEventCount = evts.filter { $0.source == "merchant" }.count
            let activity = (await activityResult) ?? []
            if activitySince == nil {
                recentActivity = activity
            } else if !activity.isEmpty {
                let merged = activity + recentActivity
                var seen = Set<String>()
                recentActivity = merged
                    .filter { seen.insert($0.id).inserted }
                    .sorted { $0.ts > $1.ts }
                    .prefix(80)
                    .map { $0 }
            }
            lastActivityTimestamp = recentActivity.first?.ts ?? lastActivityTimestamp

            let normalizedFestivals = fests.prefix(8).map { f in
                DiscoveryItem(
                    id: "fest-\(f.id)",
                    title: f.title,
                    subtitle: f.venueName ?? f.address,
                    kind: .festival,
                    hasImage: f.imageUrl != nil
                )
            }
            let normalizedEvents = evts.prefix(8).map { e in
                DiscoveryItem(
                    id: "evt-\(e.id)",
                    title: e.title,
                    subtitle: e.storeName,
                    kind: .event,
                    hasImage: e.imageUrl != nil
                )
            }

            let nextSnapshot = AgentOfficeSnapshot(
                summary: Self.summary(
                    parking: parking,
                    discovery: discovery,
                    festivals: normalizedFestivals.count,
                    events: normalizedEvents.count,
                    missingImages: normalizedFestivals.filter { !$0.hasImage }.count + normalizedEvents.filter { !$0.hasImage }.count
                ),
                parkingProviders: parking,
                discoveryProviders: discovery,
                festivals: Array(normalizedFestivals),
                events: Array(normalizedEvents),
                merchantEventCount: merchantEventCount,
                updatedAt: Date()
            )
            snapshot = nextSnapshot
            agents = Self.buildAgents(snapshot: nextSnapshot, activity: recentActivity)
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
            snapshot = AgentOfficeSnapshot(
                summary: "백엔드 연결 실패: \(error.localizedDescription)",
                parkingProviders: [],
                discoveryProviders: [],
                festivals: [],
                events: [],
                merchantEventCount: 0,
                updatedAt: Date()
            )
            agents = Self.errorAgents()
        }

    }

    // MARK: - Builders

    private static func summary(parking: [ProviderHealth], discovery: [ProviderHealth], festivals: Int, events: Int, missingImages: Int) -> String {
        let p = providerCounts(parking)
        let d = providerCounts(discovery)
        return "주차 \(p.up)/\(p.total) 정상 · 탐색 \(d.up)/\(d.total) 정상 · 서울 인근 표본 축제 \(festivals)건 이벤트 \(events)건 · 사진 없음 \(missingImages)건"
    }

    /// 상태 문구는 실제 근거가 있는 것만 말한다. 활동 기록을 남기는 에이전트는 orion·pixel·echo뿐이고,
    /// 축제맨/행사맨 숫자는 서울 30km 표본(최대 8건)이라 전체 수집량처럼 말하지 않는다.
    static func buildAgents(snapshot: AgentOfficeSnapshot, activity: [AgentActivityEvent] = [], now: Date = Date()) -> [AgentOfficeAgent] {
        let p = providerCounts(snapshot.parkingProviders)
        let d = providerCounts(snapshot.discoveryProviders)
        let festivalCount = snapshot.festivals.count
        let eventCount = snapshot.events.count
        let missingImages = snapshot.missingImageCount
        let orion = evidence(agentId: "orion", activity: activity, now: now, workingStatus: .thinking)
        let pixel = evidence(agentId: "pixel", activity: activity, now: now, workingStatus: .validating)
        let echo = evidence(agentId: "echo", activity: activity, now: now, workingStatus: .monitoring)

        return [
            AgentOfficeAgent(
                id: "orion",
                name: AgentOfficeAgent.displayName(forID: "orion"),
                role: "운영 총괄",
                spriteAsset: "AgentChar0",
                status: orion.status,
                line: orion.line,
                reply: orion.reply
            ),
            AgentOfficeAgent(
                id: "festa",
                name: AgentOfficeAgent.displayName(forID: "festa"),
                role: "공공 축제 수집",
                spriteAsset: "AgentChar1",
                status: .idle,
                line: festivalCount > 0 ? "서울 인근 표본 축제 \(festivalCount)건 확인" : noActivityLine,
                reply: "표본은 서울 30km·최대 8건이라 전체 수집량이 아니에요."
            ),
            AgentOfficeAgent(
                id: "scout",
                name: AgentOfficeAgent.displayName(forID: "scout"),
                role: "기존 이벤트 보관",
                spriteAsset: "AgentChar2",
                status: .idle,
                line: eventCount > 0 ? "서울 인근 표본 이벤트 \(eventCount)건 확인" : noActivityLine,
                reply: "표본은 서울 30km·최대 8건이라 전체 보관량이 아니에요."
            ),
            AgentOfficeAgent(
                id: "vera",
                name: AgentOfficeAgent.displayName(forID: "vera"),
                role: "품질·누락 검증",
                spriteAsset: "AgentChar3",
                status: validatorStatus(parking: p, discovery: d),
                line: p.total + d.total == 0
                    ? checkingLine
                    : "소스 상태 주차 \(p.up)/\(p.total) · 탐색 \(d.up)/\(d.total) 정상",
                reply: p.down + d.down > 0
                    ? "응답 실패 소스 \(p.down + d.down)개"
                    : (p.stale + d.stale > 0 ? "지연 소스 \(p.stale + d.stale)개" : "소스 상태 기준, 이상 신호 없음")
            ),
            AgentOfficeAgent(
                id: "pixel",
                name: AgentOfficeAgent.displayName(forID: "pixel"),
                role: "이미지 보강",
                spriteAsset: "AgentChar5",
                status: pixel.status,
                line: pixel.line,
                reply: pixel.hasEvidence
                    ? pixel.reply
                    : (missingImages > 0 ? "서울 인근 표본 중 사진 없는 항목 \(missingImages)건" : pixel.reply)
            ),
            AgentOfficeAgent(
                id: "sentinel",
                name: AgentOfficeAgent.displayName(forID: "sentinel"),
                role: "실시간 주차 감시",
                spriteAsset: "AgentChar4",
                status: healthStatus(for: p),
                line: p.total == 0
                    ? checkingLine
                    : "주차 \(p.up)/\(p.total) 정상\(p.stale > 0 ? ", 지연 \(p.stale)" : "")",
                reply: p.down > 0 ? "응답 실패 피드 \(p.down)개" : "피드 상태 기준이에요."
            ),
            AgentOfficeAgent(
                id: "echo",
                name: AgentOfficeAgent.displayName(forID: "echo"),
                role: "게시·알림",
                spriteAsset: "AgentChar6",
                status: echo.status,
                line: echo.line,
                reply: echo.reply
            ),
            AgentOfficeAgent(
                id: "atlas",
                name: AgentOfficeAgent.displayName(forID: "atlas"),
                role: "스냅샷·CDN",
                spriteAsset: "AgentAtlas",
                status: .idle,
                line: checkingLine,
                reply: noActivityLine
            ),
            AgentOfficeAgent(
                id: "harbor",
                name: AgentOfficeAgent.displayName(forID: "harbor"),
                role: "사장님 이벤트·Slack",
                spriteAsset: "AgentHarbor",
                status: snapshot.merchantEventCount > 0 ? .monitoring : .idle,
                line: snapshot.merchantEventCount > 0
                    ? "서울 인근 사장님 이벤트 \(snapshot.merchantEventCount)건 게시 중"
                    : noActivityLine,
                reply: "새 등록은 Slack으로 전달돼요."
            ),
            AgentOfficeAgent(
                id: "relay",
                name: AgentOfficeAgent.displayName(forID: "relay"),
                role: "Cron·Queue",
                spriteAsset: "AgentRelay",
                status: .idle,
                line: checkingLine,
                reply: noActivityLine
            )
        ]
    }

    static let noActivityLine = "최근 활동 없음"
    static let checkingLine = "상태 확인 중"
    /// 이 시간 안의 기록이면 "일하는 중", 오류는 하루 동안 상태에 남긴다.
    static let workingWindow: TimeInterval = 10 * 60
    static let errorWindow: TimeInterval = 24 * 60 * 60

    private struct Evidence {
        let status: AgentOfficeStatus
        let line: String
        let reply: String
        let hasEvidence: Bool
    }

    private static func evidence(agentId: String, activity: [AgentActivityEvent], now: Date, workingStatus: AgentOfficeStatus) -> Evidence {
        guard let event = activity.first(where: { $0.agentId == agentId }),
              let date = AgentOfficeDates.parse(event.ts),
              let line = AgentActivityText.line(for: event) else {
            return Evidence(status: .idle, line: noActivityLine, reply: "기록이 생기면 여기에 보여 드려요.", hasEvidence: false)
        }
        let age = now.timeIntervalSince(date)
        let status: AgentOfficeStatus
        if AgentActivityText.isError(event) {
            let isQuota = line == AgentActivityText.headErrorLabel(reason: "4006")
            status = age < errorWindow ? (isQuota ? .blocked : .error) : .idle
        } else {
            status = age < workingWindow ? workingStatus : .idle
        }
        let reply = "마지막 기록 " + date.formatted(.relative(presentation: .named))
        return Evidence(status: status, line: line, reply: reply, hasEvidence: true)
    }

    /// 오류 원문(`localizedDescription`)은 화면에 내보내지 않는다.
    static func errorAgents() -> [AgentOfficeAgent] {
        let base = buildAgents(snapshot: .empty)
        return base.map { agent in
            switch agent.id {
            case "orion":
                return AgentOfficeAgent(id: agent.id, name: agent.name, role: agent.role, spriteAsset: agent.spriteAsset, status: .error, line: "백엔드에 연결할 수 없어요.", reply: "잠시 후 다시 불러올게요.")
            case "sentinel", "atlas", "relay":
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
        if parking.total + discovery.total == 0 { return .idle }
        return .monitoring
    }
}

private struct ProviderCounts {
    var up = 0
    var degraded = 0
    var down = 0
    var stale = 0
    var total: Int
}
