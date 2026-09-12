import Foundation

/// 로그와 익명 집계에 남길 endpoint 이름. 요청 URL에는 좌표가 들어 있어 경로 대신 이 라벨만 남긴다.
enum APIEndpointLabel: String {
    case festivals
    case localEvents = "local-events"
    case performances
    case parking
    case other

    /// Worker `ANALYTICS_EVENTS.api_error` 허용 목록 값. 로그 표기와 철자가 달라 따로 둔다.
    var analyticsLabel: String {
        switch self {
        case .festivals: return "festival"
        case .localEvents: return "local_event"
        case .performances: return "performance"
        case .parking: return "parking"
        case .other: return "other"
        }
    }
}

/// 2xx가 아닌 응답. 예전에는 전부 `URLError(.badServerResponse)`로 뭉개서 어느 endpoint가
/// 몇 번으로 실패했는지 알 수 없었다. 서버 본문은 담지 않는다 - 사용자에게 보일 일이 없다.
struct APIHTTPError: Error {
    let endpoint: APIEndpointLabel
    let statusCode: Int

    /// 잠깐 뒤 다시 해 볼 만한 상태 코드. 일반 4xx는 다시 해도 같은 답이 온다.
    var isRetryable: Bool {
        statusCode == 429 || (500..<600).contains(statusCode)
    }
}

protocol APIClientProtocol {
    func searchDestination(query: String) async throws -> [Destination]
    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot]
    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot]
    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int, pastWithinDays: Int) async throws -> [Festival]
    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent]
    func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent])
    func providerHealth() async throws -> [ProviderHealth]
    func discoveryProviderHealth() async throws -> [ProviderHealth]
    func agentActivity(since: String?, limit: Int) async throws -> [AgentActivityEvent]
    func pipelineStats() async throws -> PipelineStats
    func festival(id: String) async throws -> Festival
    func localEvent(id: String) async throws -> FreeEvent
    func registerNotificationDevice(_ registration: NotificationDeviceRegistration) async throws
    func submitEventReport(_ report: EventReportSubmission) async throws
}

/// `POST /api/notifications/register` 요청 본문. 서버가 다가오는 행사 푸시 대상을 고를 때 쓰는
/// 기기 정보와 알림 설정을 통째로 올린다. Worker의 `notificationRegisterSchema`와 필드가 1:1이다.
struct NotificationDeviceRegistration: Encodable, Equatable {
    struct Topic: Encodable, Equatable {
        var enabled: Bool
        var regions: [String]      // NotificationRegionKey 형식. 비면 전국 전체
        var categories: [String]   // 비면 전체
    }

    struct QuietHours: Encodable, Equatable {
        var enabled: Bool
        var startHour: Int
        var endHour: Int
    }

    var deviceId: String
    var apnsToken: String?
    var apnsEnvironment: String   // "production" | "sandbox"
    var festival: Topic
    var localEvent: Topic
    var quietHours: QuietHours
}

extension APIClientProtocol {
    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> [Festival] {
        try await nearbyFestivals(lat: lat, lng: lng, radiusMeters: radiusMeters, upcomingWithinDays: upcomingWithinDays, pastWithinDays: 0)
    }
}

final class APIClient: APIClientProtocol {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL = AppConfiguration.current.apiBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func searchDestination(query: String) async throws -> [Destination] {
        var components = URLComponents(url: endpoint("search/destination"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        let response: DestinationSearchResponse = try await get(components.url!, endpoint: .other)
        return response.items
    }

    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        var components = URLComponents(url: endpoint("parking/nearby"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
        let response: ParkingNearbyResponse = try await get(components.url!, endpoint: .parking)
        return response.items
    }

    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        var components = URLComponents(url: endpoint("parking/realtime"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
        let response: ParkingNearbyResponse = try await get(components.url!, endpoint: .parking)
        return response.items
    }

    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int, pastWithinDays: Int) async throws -> [Festival] {
        var components = URLComponents(url: endpoint("api/festivals"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters)),
            URLQueryItem(name: "upcomingWithinDays", value: String(upcomingWithinDays)),
            URLQueryItem(name: "pastWithinDays", value: String(pastWithinDays))
        ]
        let pages: [DiscoverFestivalsResponse] = try await discoveryPages(components, endpoint: .festivals)
        return uniqueItems(pages.flatMap(\.items)).sorted(by: festivalOrder)
    }

    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent] {
        var components = URLComponents(url: endpoint("api/local-events"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters))
        ]
        let pages: [DiscoverEventsResponse] = try await discoveryPages(components, endpoint: .localEvents)
        return uniqueItems(pages.flatMap(\.items)).sorted {
            if $0.isSponsored != $1.isSponsored { return $0.isSponsored }
            if $0.priorityScore != $1.priorityScore { return $0.priorityScore > $1.priorityScore }
            if $0.distanceMeters != $1.distanceMeters { return $0.distanceMeters < $1.distanceMeters }
            return $0.id < $1.id
        }
    }

    func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent]) {
        var components = URLComponents(url: endpoint("api/performances"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(lat)),
            URLQueryItem(name: "lng", value: String(lng)),
            URLQueryItem(name: "radiusMeters", value: String(radiusMeters)),
            URLQueryItem(name: "upcomingWithinDays", value: String(upcomingWithinDays))
        ]
        let pages: [DiscoverPerformancesResponse] = try await discoveryPages(components, endpoint: .performances)
        let festivals = uniqueItems(pages.flatMap(\.festivals)).sorted(by: festivalOrder)
        let events = uniqueItems(pages.flatMap(\.events)).sorted {
            if $0.timelineStatus != $1.timelineStatus { return $0.timelineStatus == .ongoing }
            if $0.distanceMeters != $1.distanceMeters { return $0.distanceMeters < $1.distanceMeters }
            return $0.id < $1.id
        }
        return (festivals, events)
    }

    /// 페이지 크기는 전송 단위이지 핀 상한이 아니다. 빈 페이지도 다음 커서가
    /// 있으면 계속 읽고, 중간 실패/취소는 일부 결과를 완료된 조회로 반환하지 않는다.
    private func discoveryPages<Page: DiscoverCursorPage>(
        _ base: URLComponents, endpoint: APIEndpointLabel
    ) async throws -> [Page] {
        var pages: [Page] = []
        var cursor: String?
        var seenCursors = Set<String>()
        repeat {
            try Task.checkCancellation()
            var components = base
            components.queryItems = (base.queryItems ?? []) + [URLQueryItem(name: "paged", value: "true")]
            if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
            let page: Page = try await get(components.url!, endpoint: endpoint)
            try Task.checkCancellation()
            pages.append(page)
            cursor = page.nextCursor
            if let cursor, cursor.isEmpty || !seenCursors.insert(cursor).inserted {
                throw URLError(.badServerResponse)
            }
        } while cursor != nil
        return pages
    }

    private func uniqueItems<Item: Identifiable>(_ items: [Item]) -> [Item] {
        var seen = Set<Item.ID>()
        return items.filter { seen.insert($0.id).inserted }
    }

    private func festivalOrder(_ lhs: Festival, _ rhs: Festival) -> Bool {
        if lhs.status != rhs.status { return lhs.status == .ongoing }
        if lhs.distanceMeters != rhs.distanceMeters { return lhs.distanceMeters < rhs.distanceMeters }
        return lhs.id < rhs.id
    }

    func providerHealth() async throws -> [ProviderHealth] {
        let response: ProviderHealthResponse = try await get(endpoint("parking/providers/health"), endpoint: .other)
        return response.providers
    }

    func discoveryProviderHealth() async throws -> [ProviderHealth] {
        let response: ProviderHealthResponse = try await get(endpoint("discover/providers/health"), endpoint: .other)
        return response.providers
    }

    func pipelineStats() async throws -> PipelineStats {
        try await get(endpoint("discover/pipeline-stats"), endpoint: .other)
    }

    func festival(id: String) async throws -> Festival {
        let response: DiscoverFestivalDetailResponse = try await get(endpoint("api/festivals/\(id)"), endpoint: .festivals)
        return response.item
    }

    func localEvent(id: String) async throws -> FreeEvent {
        let response: DiscoverEventDetailResponse = try await get(endpoint("api/local-events/\(id)"), endpoint: .localEvents)
        return response.item
    }

    func registerNotificationDevice(_ registration: NotificationDeviceRegistration) async throws {
        try await post(endpoint("api/notifications/register"), body: registration)
    }

    func submitEventReport(_ report: EventReportSubmission) async throws {
        try await post(endpoint("api/event-reports"), body: report)
    }

    func agentActivity(since: String?, limit: Int) async throws -> [AgentActivityEvent] {
        var components = URLComponents(url: endpoint("agent-office/activity"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let since, !since.isEmpty {
            items.append(URLQueryItem(name: "since", value: since))
        }
        components.queryItems = items
        let response: AgentActivityResponse = try await get(components.url!, endpoint: .other)
        return response.items
    }

    private func endpoint(_ path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    /// 일시적 실패에 한 번만 다시 시도한다. GET 전용이고, 재시도해도 답이 같은 실패
    /// (일반 4xx, 디코딩 실패, 취소, 오프라인)는 그대로 던진다.
    private func get<T: Decodable>(_ url: URL, endpoint label: APIEndpointLabel) async throws -> T {
        do {
            return try await performGet(url, endpoint: label)
        } catch {
            let firstError = error
            guard Self.isTransient(firstError) else {
                report(firstError, endpoint: label)
                throw firstError
            }
            do {
                try await Task.sleep(nanoseconds: Self.retryDelayNanoseconds)
                return try await performGet(url, endpoint: label)
            } catch {
                report(error, endpoint: label)
                throw error
            }
        }
    }

    private func performGet<T: Decodable>(_ url: URL, endpoint label: APIEndpointLabel) async throws -> T {
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIHTTPError(endpoint: label, statusCode: http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static let retryDelayNanoseconds: UInt64 = 400_000_000

    private static func isTransient(_ error: Error) -> Bool {
        if let http = error as? APIHTTPError { return http.isRetryable }
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .timedOut, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }

    /// 좌표가 들어 있는 URL은 절대 남기지 않는다. endpoint 라벨과 상태 코드만 남긴다.
    private func report(_ error: Error, endpoint label: APIEndpointLabel) {
        if let http = error as? APIHTTPError {
            AppLogger.networking.error(
                "API call failed endpoint=\(label.rawValue, privacy: .public) status=\(http.statusCode, privacy: .public)"
            )
        } else if let urlError = error as? URLError {
            AppLogger.networking.error(
                "API call failed endpoint=\(label.rawValue, privacy: .public) urlErrorCode=\(urlError.code.rawValue, privacy: .public)"
            )
        } else {
            AppLogger.networking.error(
                "API call failed endpoint=\(label.rawValue, privacy: .public) decodeOrOther"
            )
        }
        AnalyticsService.shared.track(.apiError, label: label.analyticsLabel)
    }

    private func post<T: Encodable>(_ url: URL, body: T) async throws {
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
        } catch {
            // 기기 등록과 오류 신고가 여기로 온다. 실패해도 화면에는 안 보이므로 로그가 유일한 흔적이다.
            AppLogger.networking.error("API post failed: \(error.localizedDescription)")
            AnalyticsService.shared.track(.apiError, label: "other")
            throw error
        }
    }
}

final class MockAPIClient: APIClientProtocol {
    func searchDestination(query: String) async throws -> [Destination] {
        [
            Destination(id: "dest-seoul-station", name: query.isEmpty ? "Seoul Station" : query, address: "405 Hangang-daero, Jung-gu, Seoul", lat: 37.5547, lng: 126.9706, source: "mock"),
            Destination(id: "dest-cityhall", name: "Seoul City Hall", address: "110 Sejong-daero, Jung-gu, Seoul", lat: 37.5663, lng: 126.9779, source: "mock")
        ]
    }

    func nearbyParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        [
            ParkingLot(id: "mock:1", source: "mock", sourceParkingId: "1", name: "Seoul Station West Public Parking", address: "378 Cheongpa-ro, Yongsan-gu, Seoul", lat: lat + 0.001, lng: lng - 0.001, distanceFromDestinationMeters: 180, totalCapacity: 120, availableSpaces: 18, occupancyRate: 0.85, congestionStatus: .available, realtimeAvailable: true, freshnessTimestamp: ISO8601DateFormatter().string(from: Date()), operatingHours: "24 hours", feeSummary: "KRW 500 / 10 min", supportsEv: true, supportsAccessible: true, isPublic: true, isPrivate: false, stale: false, displayStatus: "Realtime 18 spaces", score: 0.91, provenance: []),
            ParkingLot(id: "mock:2", source: "mock", sourceParkingId: "2", name: "Destination Private Parking", address: "1 Tongil-ro, Jung-gu, Seoul", lat: lat - 0.001, lng: lng + 0.001, distanceFromDestinationMeters: 260, totalCapacity: 60, availableSpaces: nil, occupancyRate: nil, congestionStatus: .moderate, realtimeAvailable: true, freshnessTimestamp: ISO8601DateFormatter().string(from: Date()), operatingHours: "07:00-23:00", feeSummary: "KRW 2,000 / 30 min", supportsEv: false, supportsAccessible: false, isPublic: false, isPrivate: true, stale: false, displayStatus: "Moderate", score: 0.72, provenance: []),
            ParkingLot(id: "mock:3", source: "mock", sourceParkingId: "3", name: "Stale Public Parking", address: "110 Sejong-daero, Jung-gu, Seoul", lat: lat + 0.002, lng: lng + 0.001, distanceFromDestinationMeters: 420, totalCapacity: 80, availableSpaces: 7, occupancyRate: 0.91, congestionStatus: .busy, realtimeAvailable: false, freshnessTimestamp: ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: -1200)), operatingHours: "09:00-22:00", feeSummary: "KRW 3,000 / hour", supportsEv: false, supportsAccessible: true, isPublic: true, isPrivate: false, stale: true, displayStatus: "Update may be delayed", score: 0.48, provenance: [])
        ]
    }

    func nearbyFestivals(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int, pastWithinDays: Int) async throws -> [Festival] {
        [
            Festival(id: "mock-festival", title: "Seoul Light Festival", subtitle: "Night walk festival",
                     description: nil, startDate: "2026-04-15", endDate: "2026-04-22",
                     status: .ongoing, venueName: "Seoul Plaza",
                     address: "110 Sejong-daero, Jung-gu, Seoul",
                     lat: lat + 0.001, lng: lng + 0.001, distanceMeters: 160,
                     source: "mock", sourceUrl: nil, imageUrl: nil, imageUrls: [], tags: ["festival"],
                     primaryCategory: nil, categoryTags: nil)
        ]
    }

    func realtimeParking(lat: Double, lng: Double, radiusMeters: Int) async throws -> [ParkingLot] {
        try await nearbyParking(lat: lat, lng: lng, radiusMeters: radiusMeters).filter {
            $0.realtimeAvailable && $0.availableSpaces != nil
        }
    }

    func nearbyEvents(lat: Double, lng: Double, radiusMeters: Int) async throws -> [FreeEvent] {
        [
            FreeEvent(
                id: "mock-event",
                title: "Cafe review event",
                eventType: "review_event",
                category: "local_event",
                sourceId: "mock-event",
                startDate: "2026-05-01",
                endDate: "2026-05-31",
                status: .approved,
                storeName: "Sample Cafe",
                venueName: "Sample Cafe",
                address: "110 Sejong-daero, Jung-gu, Seoul",
                lat: lat + 0.0015,
                lng: lng - 0.001,
                distanceMeters: 190,
                source: "owner_submitted",
                sourceUrl: "https://example.com/sample-cafe-event",
                imageUrl: nil,
                benefit: "Free americano for review",
                shortDescription: "Visit and write a review to receive a drink benefit.",
                region: "Seoul",
                updatedAt: nil,
                confidenceScore: 1,
                needsReview: false,
                isSponsored: true,
                sponsorTier: "local_boost",
                paidUntil: "2026-05-31",
                priorityScore: 50
            )
        ]
    }

    func nearbyPerformances(lat: Double, lng: Double, radiusMeters: Int, upcomingWithinDays: Int) async throws -> (festivals: [Festival], events: [FreeEvent]) {
        return (
            festivals: [
                Festival(id: "mock-perf-festival", title: "2026 서울재즈페스티벌", subtitle: "음악 공연",
                         description: nil, startDate: "2026-05-24", endDate: "2026-05-26",
                         status: .upcoming, venueName: "올림픽공원 88잔디마당",
                         address: "서울특별시 송파구 올림픽로 424",
                         lat: lat + 0.002, lng: lng + 0.002, distanceMeters: 280,
                         source: "mock", sourceUrl: nil, imageUrl: nil, imageUrls: [], tags: [],
                         primaryCategory: .musicPerformance, categoryTags: ["공연"])
            ],
            events: []
        )
    }


    func providerHealth() async throws -> [ProviderHealth] {
        [ProviderHealth(name: "mock", status: "up", lastSuccessAt: ISO8601DateFormatter().string(from: Date()), lastError: nil, qualityScore: 1, stale: false)]
    }

    func discoveryProviderHealth() async throws -> [ProviderHealth] {
        [
            ProviderHealth(name: "mock-festival-provider", status: "up", lastSuccessAt: ISO8601DateFormatter().string(from: Date()), lastError: nil, qualityScore: 1, stale: false),
            ProviderHealth(name: "mock-local-event-provider", status: "degraded", lastSuccessAt: ISO8601DateFormatter().string(from: Date()), lastError: "Mock review backlog", qualityScore: 0.7, stale: false)
        ]
    }

    func pipelineStats() async throws -> PipelineStats {
        let now = ISO8601DateFormatter().string(from: Date())
        return PipelineStats(
            generatedAt: now,
            discoveryItems: .init(
                total: 120,
                byType: [.init(type: "festival", count: 120)],
                bySource: [.init(source: "kopis", count: 40), .init(source: "public-data-culture-festival", count: 80)],
                byStatus: [.init(status: "upcoming", count: 70), .init(status: "ongoing", count: 50)],
                byPrimaryCategory: [.init(category: "music_performance", count: 60), .init(category: "untagged", count: 20)],
                taggingCoverage: .init(tagged: 100, total: 120),
                feeCoverage: .init(free: 30, paid: 60, unknown: 20, unchecked: 10),
                ingestion: .init(
                    newLast24h: 12,
                    newLast7d: 48,
                    refreshedLast24h: 110,
                    staleOver7d: 4,
                    staleEndedOver7d: 6,
                    missingCoordinates: 1,
                    latestFirstSeenAt: now,
                    latestSyncedAt: now,
                    dailyNew: [.init(date: "2026-08-14", count: 20), .init(date: "2026-08-15", count: 12)],
                    newBySourceLast7d: [.init(source: "kopis", count: 30), .init(source: "akei-trade-expo", count: 18)]
                ),
                tagging: .init(
                    llmTagged: 100,
                    fallbackTagged: 12,
                    pending: 8,
                    oldestPendingFirstSeenAt: now,
                    lastTaggedAt: now,
                    byModel: [.init(model: "mock-model", count: 100)]
                ),
                fee: .init(oldestUncheckedFirstSeenAt: now, lastCheckedAt: now, checkedLast24h: 60),
                backfill: .init(
                    geocodePending: 2600,
                    geocodeLastCheckedAt: now,
                    geocodeCheckedLast24h: 42,
                    imagePending: 180,
                    imageLastCheckedAt: now,
                    imageCheckedLast24h: 30
                )
            ),
            localEvents: .init(
                total: 40,
                byStatus: [.init(status: "approved", count: 30), .init(status: "pending", count: 10)],
                bySource: [.init(source: "naver_blog", count: 40)],
                byEventType: [.init(eventType: "discount", count: 25), .init(eventType: "popup", count: 15)],
                needsReview: 8,
                taggingCoverage: .init(tagged: 35, total: 40),
                ingestion: .init(
                    newLast24h: 5,
                    newLast7d: 18,
                    approvedLast7d: 12,
                    averageConfidence: 0.72,
                    oldestPendingCreatedAt: now,
                    latestCreatedAt: now,
                    dailyNew: [.init(date: "2026-08-14", count: 7), .init(date: "2026-08-15", count: 5)]
                )
            ),
            cityFestivals: .init(
                total: 950,
                geocodeChecked: 400,
                geocodeUnchecked: 550,
                upcoming: 300,
                ended: 650,
                scrapedLast24h: 120,
                lastScrapedAt: now
            ),
            akeiTradeExpos: .init(total: 25, upcoming: 20, scrapedLast24h: 25, lastScrapedAt: now),
            syncActivity: .init(
                running: 1,
                last24h: .init(runs: 30, success: 28, failed: 1, timeout: 1, fetched: 900, upserted: 120, skipped: 760, pruned: 20),
                byType: [
                    .init(syncType: "discover:festival:kopis", runs: 12, success: 12, failed: 0, timeout: 0, fetched: 400, upserted: 60, pruned: 8, lastStartedAt: now)
                ],
                lastSuccessAt: now
            ),
            recentSyncRuns: [
                .init(id: "mock-run-1", syncType: "discovery", startedAt: now, finishedAt: now, status: "success", fetched: 200, upserted: 50, skipped: 145, pruned: 5, message: nil)
            ]
        )
    }

    func agentActivity(since: String?, limit: Int) async throws -> [AgentActivityEvent] {
        let now = ISO8601DateFormatter().string(from: Date())
        return [
            AgentActivityEvent(id: "mock-1", ts: now, agentId: "scout", action: "found", targetKind: "local_event", targetId: "mock-event", targetTitle: "샘플 카페 리뷰 이벤트", verdict: nil, reason: nil),
            AgentActivityEvent(id: "mock-2", ts: now, agentId: "orion", action: "validate", targetKind: "local_event", targetId: "mock-event", targetTitle: "샘플 카페 리뷰 이벤트", verdict: "approve", reason: "혜택과 매장 정보 일치"),
            AgentActivityEvent(id: "mock-3", ts: now, agentId: "echo", action: "post", targetKind: "local_event", targetId: "mock-event", targetTitle: "샘플 카페 리뷰 이벤트", verdict: nil, reason: nil)
        ]
    }

    func festival(id: String) async throws -> Festival {
        let items = try await nearbyFestivals(lat: 0, lng: 0, radiusMeters: 0, upcomingWithinDays: 365, pastWithinDays: 0)
        guard let match = items.first(where: { $0.id == id }) else { throw URLError(.resourceUnavailable) }
        return match
    }

    func localEvent(id: String) async throws -> FreeEvent {
        let items = try await nearbyEvents(lat: 0, lng: 0, radiusMeters: 0)
        guard let match = items.first(where: { $0.id == id }) else { throw URLError(.resourceUnavailable) }
        return match
    }

    func registerNotificationDevice(_ registration: NotificationDeviceRegistration) async throws {}
    func submitEventReport(_ report: EventReportSubmission) async throws {}
}
