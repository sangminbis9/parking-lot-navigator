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

    struct DiscoveryItemsSection: Codable, Hashable {
        let total: Int
        let byType: [CountEntry]
        let bySource: [SourceEntry]
        let taggingCoverage: Coverage
        let feeCoverage: FeeCoverage
    }

    struct LocalEventsSection: Codable, Hashable {
        let total: Int
        let byStatus: [StatusEntry]
        let bySource: [SourceEntry]
        let needsReview: Int
        let taggingCoverage: Coverage
    }

    struct CityFestivalsSection: Codable, Hashable {
        let total: Int
        let geocodeChecked: Int
        let geocodeUnchecked: Int
        let upcoming: Int
        let ended: Int
    }

    struct AkeiTradeExposSection: Codable, Hashable {
        let total: Int
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
    let recentSyncRuns: [SyncRun]
}
