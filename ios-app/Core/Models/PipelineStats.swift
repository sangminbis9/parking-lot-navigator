import Foundation

struct PipelineStats: Codable, Hashable {
    struct CountEntry: Codable, Hashable, Identifiable {
        let type: String
        let count: Int
        var id: String { type }
    }

    struct SourceEntry: Codable, Hashable, Identifiable {
        let source: String
        let count: Int
        var id: String { source }
    }

    struct StatusEntry: Codable, Hashable, Identifiable {
        let status: String
        let count: Int
        var id: String { status }
    }

    struct CategoryEntry: Codable, Hashable, Identifiable {
        let category: String
        let count: Int
        var id: String { category }
    }

    struct EventTypeEntry: Codable, Hashable, Identifiable {
        let eventType: String
        let count: Int
        var id: String { eventType }
    }

    struct ModelEntry: Codable, Hashable, Identifiable {
        let model: String
        let count: Int
        var id: String { model }
    }

    struct DailyCount: Codable, Hashable, Identifiable {
        let date: String
        let count: Int
        var id: String { date }
    }

    struct Coverage: Codable, Hashable {
        let tagged: Int
        let total: Int
    }

    struct FeeCoverage: Codable, Hashable {
        let free: Int
        let paid: Int
        let unknown: Int
        let unchecked: Int
    }

    struct DiscoveryIngestion: Codable, Hashable {
        let newLast24h: Int
        let newLast7d: Int
        let refreshedLast24h: Int
        let staleOver7d: Int
        let staleEndedOver7d: Int
        let missingCoordinates: Int
        let latestFirstSeenAt: String?
        let latestSyncedAt: String?
        let dailyNew: [DailyCount]
        let newBySourceLast7d: [SourceEntry]
    }

    struct TaggingSection: Codable, Hashable {
        let llmTagged: Int
        let fallbackTagged: Int
        let pending: Int
        let oldestPendingFirstSeenAt: String?
        let lastTaggedAt: String?
        let byModel: [ModelEntry]
    }

    struct FeeSection: Codable, Hashable {
        let oldestUncheckedFirstSeenAt: String?
        let lastCheckedAt: String?
        let checkedLast24h: Int
    }

    struct DiscoveryItemsSection: Codable, Hashable {
        let total: Int
        let byType: [CountEntry]
        let bySource: [SourceEntry]
        let byStatus: [StatusEntry]
        let byPrimaryCategory: [CategoryEntry]
        let taggingCoverage: Coverage
        let feeCoverage: FeeCoverage
        let ingestion: DiscoveryIngestion
        let tagging: TaggingSection
        let fee: FeeSection
    }

    struct LocalEventIngestion: Codable, Hashable {
        let newLast24h: Int
        let newLast7d: Int
        let approvedLast7d: Int
        let averageConfidence: Double?
        let oldestPendingCreatedAt: String?
        let latestCreatedAt: String?
        let dailyNew: [DailyCount]
    }

    struct LocalEventsSection: Codable, Hashable {
        let total: Int
        let byStatus: [StatusEntry]
        let bySource: [SourceEntry]
        let byEventType: [EventTypeEntry]
        let needsReview: Int
        let taggingCoverage: Coverage
        let ingestion: LocalEventIngestion
    }

    struct CityFestivalsSection: Codable, Hashable {
        let total: Int
        let geocodeChecked: Int
        let geocodeUnchecked: Int
        let upcoming: Int
        let ended: Int
        let scrapedLast24h: Int
        let lastScrapedAt: String?
    }

    struct AkeiTradeExposSection: Codable, Hashable {
        let total: Int
        let upcoming: Int
        let scrapedLast24h: Int
        let lastScrapedAt: String?
    }

    struct SyncTotals: Codable, Hashable {
        let runs: Int
        let success: Int
        let failed: Int
        let timeout: Int
        let fetched: Int
        let upserted: Int
        let skipped: Int
        let pruned: Int
    }

    struct SyncTypeSummary: Codable, Hashable, Identifiable {
        let syncType: String
        let runs: Int
        let success: Int
        let failed: Int
        let timeout: Int
        let fetched: Int
        let upserted: Int
        let pruned: Int
        let lastStartedAt: String?
        var id: String { syncType }
    }

    struct SyncActivitySection: Codable, Hashable {
        let running: Int
        let last24h: SyncTotals
        let byType: [SyncTypeSummary]
        let lastSuccessAt: String?
    }

    struct SyncRun: Codable, Hashable, Identifiable {
        let id: String
        let syncType: String
        let startedAt: String
        let finishedAt: String?
        let status: String
        let fetched: Int
        let upserted: Int
        let skipped: Int
        let pruned: Int
        let message: String?
    }

    let generatedAt: String
    let discoveryItems: DiscoveryItemsSection
    let localEvents: LocalEventsSection
    let cityFestivals: CityFestivalsSection
    let akeiTradeExpos: AkeiTradeExposSection
    let syncActivity: SyncActivitySection
    let recentSyncRuns: [SyncRun]
}
