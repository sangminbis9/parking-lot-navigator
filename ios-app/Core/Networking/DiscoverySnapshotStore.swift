import CryptoKit
import Foundation

extension Notification.Name {
    static let discoverySnapshotChanged = Notification.Name("discoverySnapshotChanged")
    static let discoverySnapshotStatusChanged = Notification.Name("discoverySnapshotStatusChanged")
}

struct DiscoverySnapshotManifest: Codable {
    struct Part: Codable {
        let sha256: String
        let bytes: Int
        let count: Int
    }
    let schemaVersion: Int
    let version: String
    let generatedAt: String
    let parts: [Part]
    let count: Int

    func validate() throws {
        guard schemaVersion == 1, UUID(uuidString: version) != nil,
              DiscoverySnapshotStore.date(generatedAt) != nil, count >= 0,
              Set(parts.map(\.sha256)).count == parts.count else { throw DiscoverySnapshotError.invalidData }
        var bytes = 0
        var records = 0
        for part in parts {
            guard part.sha256.count == 64, part.sha256.allSatisfy({ "0123456789abcdef".contains($0) }),
                  part.bytes > 0, part.bytes <= 8 * 1024 * 1024, part.count > 0,
                  part.count <= 256 else { throw DiscoverySnapshotError.invalidData }
            bytes += part.bytes
            records += part.count
        }
        // Safety budget rejects the WHOLE update, never truncates pins. Inspect size
        // telemetry before raising it or moving to regional packs on larger datasets.
        guard bytes <= 128 * 1024 * 1024, records == count else { throw DiscoverySnapshotError.invalidData }
    }
}

struct DiscoverySnapshotPart: Codable {
    let schemaVersion: Int
    let festivals: [Festival]
    let performanceEvents: [FreeEvent]
    let localEvents: [FreeEvent]
}

enum DiscoverySnapshotError: Error, LocalizedError {
    case notReady, invalidData, unavailable
    var errorDescription: String? {
        switch self {
        case .notReady: return "행사 데이터가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요."
        case .invalidData: return "행사 데이터 검증에 실패했어요. 저장된 데이터는 유지됩니다."
        case .unavailable: return "행사 데이터를 내려받지 못했어요. 잠시 후 다시 시도해 주세요."
        }
    }
}

struct DiscoverySnapshotDownload {
    let data: Data
    let statusCode: Int
    let etag: String?
}

struct DiscoverySnapshotStatus: Equatable {
    var generatedAt: Date?
    var isUpdating = false
    var refreshFailed = false

    var referenceTimeText: String {
        guard let generatedAt else { return "아직 저장된 행사 데이터가 없어요" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = TimeZone(secondsFromGMT: 9 * 3600)
        formatter.dateFormat = "yyyy년 M월 d일 HH:mm"
        return "\(formatter.string(from: generatedAt)) 기준 (한국 시간)"
    }

    var detailText: String {
        if isUpdating { return "행사 데이터 업데이트 중" }
        if refreshFailed {
            return generatedAt == nil ? "행사 데이터를 내려받지 못했어요. 잠시 후 다시 시도해 주세요."
                : "업데이트를 확인하지 못해 저장된 행사 데이터를 사용 중이에요."
        }
        return "행사 데이터가 발행된 시간입니다. 주차 정보의 갱신 시간과는 다를 수 있어요."
    }
}

/// Shared by map/list/widget sync. Disk I/O, decoding, distance calculations and
/// indexing run on this actor, never the MainActor. Panning cannot trigger D1 reads.
actor DiscoverySnapshotStore {
    typealias Loader = (URL, Int, String?) async throws -> DiscoverySnapshotDownload
    static let shared = DiscoverySnapshotStore(baseURL: AppConfiguration.current.discoverySnapshotBaseURL)
    private let baseURL: URL
    private let directory: URL
    private let loader: Loader
    private let now: () -> Date
    private var index: DiscoverySnapshotIndex?
    private var manifest: DiscoverySnapshotManifest?
    private var loadedDisk = false
    private var refreshTask: Task<DiscoverySnapshotIndex, Error>?
    private var nextCheck = Date.distantPast
    private var etag: String?
    private var lastRefreshFailed = false

    init(baseURL: URL, directory: URL? = nil, session: URLSession = .shared,
         now: @escaping () -> Date = Date.init, loader: Loader? = nil) {
        self.baseURL = baseURL
        self.now = now
        let namespace = Self.hash(Data(baseURL.absoluteString.utf8))
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DiscoverySnapshots/\(namespace)", isDirectory: true)
        self.loader = loader ?? { url, maxBytes, etag in
            var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30)
            if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            // Download to disk first: a malformed/oversized response must not grow RAM unboundedly.
            let (temporary, response) = try await session.download(for: request)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard let http = response as? HTTPURLResponse else { throw DiscoverySnapshotError.unavailable }
            let size = (try FileManager.default.attributesOfItem(atPath: temporary.path)[.size] as? NSNumber)?.intValue ?? 0
            guard size <= maxBytes else { throw DiscoverySnapshotError.invalidData }
            return DiscoverySnapshotDownload(data: try Data(contentsOf: temporary), statusCode: http.statusCode,
                                             etag: http.value(forHTTPHeaderField: "ETag"))
        }
    }

    func festivals(lat: Double, lng: Double, radius: Int, upcoming: Int, past: Int = 0) async throws -> [Festival] {
        let data = try await dataset()
        try Task.checkCancellation()
        return data.festivals(lat: lat, lng: lng, radius: radius, upcoming: upcoming, past: past, now: now())
    }
    func events(lat: Double, lng: Double, radius: Int) async throws -> [FreeEvent] {
        let data = try await dataset()
        try Task.checkCancellation()
        return data.events(lat: lat, lng: lng, radius: radius, now: now())
    }
    func performances(lat: Double, lng: Double, radius: Int, upcoming: Int) async throws -> (festivals: [Festival], events: [FreeEvent]) {
        let data = try await dataset()
        try Task.checkCancellation()
        return data.performances(lat: lat, lng: lng, radius: radius, upcoming: upcoming, now: now())
    }
    func festival(id: String) async throws -> Festival? {
        let data = try await dataset()
        return data.festival(id: id, now: now())
    }
    func event(id: String) async throws -> FreeEvent? { try await dataset().eventByID[id] }

    /// Settings can recover the timestamp after relaunch without a network request.
    func currentStatus() -> DiscoverySnapshotStatus {
        loadDiskIfNeeded()
        return snapshotStatus
    }

    private var snapshotStatus: DiscoverySnapshotStatus {
        DiscoverySnapshotStatus(generatedAt: manifest.flatMap { Self.date($0.generatedAt) },
            isUpdating: refreshTask != nil, refreshFailed: lastRefreshFailed)
    }

    /// Useful for explicit refresh/tests; regular queries use stale-while-revalidate.
    func refreshIfDue() async throws {
        loadDiskIfNeeded()
        guard now() >= nextCheck else { return }
        _ = try await startRefresh().value
    }

    @discardableResult func refreshNow() async throws -> Bool {
        loadDiskIfNeeded()
        nextCheck = .distantPast
        let before = manifest?.version
        _ = try await startRefresh().value
        return before != manifest?.version
    }

    private func loadDiskIfNeeded() {
        if !loadedDisk {
            loadedDisk = true
            do {
                let data = try Self.read(directory.appendingPathComponent("manifest.json"), limit: 4 * 1024 * 1024)
                let saved = try JSONDecoder().decode(DiscoverySnapshotManifest.self, from: data)
                try saved.validate()
                let parts = try saved.parts.map { try Self.decodePart(Self.read(partURL($0.sha256), limit: $0.bytes), descriptor: $0) }
                index = DiscoverySnapshotIndex(parts: parts)
                manifest = saved
                publishStatus()
            } catch {
                // Broken/missing part invalidates the saved release, not individual pins.
                // Valid content-addressed files can still be reused during repair.
            }
        }
    }

    private func dataset() async throws -> DiscoverySnapshotIndex {
        loadDiskIfNeeded()
        if let index {
            if now() >= nextCheck { _ = startRefresh() }
            publishStatus()
            return index
        }
        if let refreshTask { return try await refreshTask.value }
        guard now() >= nextCheck else { throw DiscoverySnapshotError.unavailable }
        return try await startRefresh().value
    }

    private func startRefresh() -> Task<DiscoverySnapshotIndex, Error> {
        if let refreshTask { return refreshTask }
        // Unstructured shared work intentionally outlives a single cancelled viewport.
        let task = Task { try await self.refresh() }
        refreshTask = task
        publishStatus()
        return task
    }

    private func refresh() async throws -> DiscoverySnapshotIndex {
        defer { refreshTask = nil; publishStatus() }
        do {
            let result = try await loader(baseURL.appendingPathComponent("manifest.json"), 4 * 1024 * 1024, etag)
            if result.statusCode == 304, let index {
                nextCheck = now().addingTimeInterval(60)
                lastRefreshFailed = false
                return index
            }
            guard result.statusCode == 200 else {
                if result.statusCode == 503 || result.statusCode == 404 { throw DiscoverySnapshotError.notReady }
                throw DiscoverySnapshotError.unavailable
            }
            guard result.data.count <= 4 * 1024 * 1024 else { throw DiscoverySnapshotError.invalidData }
            let next = try JSONDecoder().decode(DiscoverySnapshotManifest.self, from: result.data)
            try next.validate()
            if let old = manifest, let oldDate = Self.date(old.generatedAt), let nextDate = Self.date(next.generatedAt), nextDate < oldDate {
                throw DiscoverySnapshotError.invalidData // stale CDN must not roll back a release
            }
            if manifest?.version == next.version, let index {
                etag = result.etag
                nextCheck = now().addingTimeInterval(60)
                lastRefreshFailed = false
                return index
            }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var folder = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try folder.setResourceValues(values)
            let files = next.parts
            // Bound abandoned staging files across failed releases while retaining
            // every file referenced by the current commit marker.
            let keepHashes = Set(files.map(\.sha256)).union(manifest?.parts.map(\.sha256) ?? [])
            cleanup(keeping: Set(keepHashes.map { "\($0).json" }).union(["manifest.json"]))
            let baseURL = self.baseURL
            let directory = self.directory
            let loader = self.loader
            // Four bounded downloads; no one-task-per-pin or unbounded task fanout.
            let parts = try await withThrowingTaskGroup(of: (Int, DiscoverySnapshotPart).self) { group in
                func enqueue(_ position: Int) {
                    let descriptor = files[position]
                    group.addTask {
                        let url = directory.appendingPathComponent("\(descriptor.sha256).json")
                        if let saved = try? Self.read(url, limit: descriptor.bytes),
                           let part = try? Self.decodePart(saved, descriptor: descriptor) { return (position, part) }
                        let response = try await loader(baseURL.appendingPathComponent("parts/\(descriptor.sha256).json"), descriptor.bytes, nil)
                        guard response.statusCode == 200 else { throw DiscoverySnapshotError.unavailable }
                        let part = try Self.decodePart(response.data, descriptor: descriptor)
                        try response.data.write(to: url, options: .atomic)
                        return (position, part)
                    }
                }
                var nextPosition = min(4, files.count)
                for position in 0..<nextPosition { enqueue(position) }
                var ordered: [Int: DiscoverySnapshotPart] = [:]
                while let (position, part) = try await group.next() {
                    ordered[position] = part
                    if nextPosition < files.count { enqueue(nextPosition); nextPosition += 1 }
                }
                return (0..<files.count).map { ordered[$0]! }
            }
            let newIndex = DiscoverySnapshotIndex(parts: parts)
            // Atomic commit marker LAST. Process death/failed download keeps old files+manifest.
            try result.data.write(to: directory.appendingPathComponent("manifest.json"), options: .atomic)
            let oldVersion = manifest?.version
            manifest = next
            index = newIndex
            etag = result.etag
            lastRefreshFailed = false
            nextCheck = now().addingTimeInterval(60)
            cleanup(keeping: Set(files.map { "\($0.sha256).json" }).union(["manifest.json"]))
            if oldVersion != nil && oldVersion != next.version {
                NotificationCenter.default.post(name: .discoverySnapshotChanged, object: nil)
            }
            return newIndex
        } catch {
            lastRefreshFailed = true
            nextCheck = now().addingTimeInterval(5 * 60) // no pan-triggered retry storm
            throw error
        }
    }

    private func partURL(_ hash: String) -> URL { directory.appendingPathComponent("\(hash).json") }
    private func cleanup(keeping names: Set<String>) {
        // Only direct content-addressed files in this store's namespace, never recursive deletion.
        guard let urls = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for url in urls where !names.contains(url.lastPathComponent) && url.pathExtension == "json" {
            let name = url.deletingPathExtension().lastPathComponent
            if name.count == 64 && name.allSatisfy({ "0123456789abcdef".contains($0) }) { try? FileManager.default.removeItem(at: url) }
        }
    }
    private func publishStatus() {
        var info: [String: Any] = ["updating": refreshTask != nil, "failed": lastRefreshFailed]
        info["status"] = snapshotStatus
        if let generatedAt = manifest?.generatedAt { info["generatedAt"] = generatedAt }
        NotificationCenter.default.post(name: .discoverySnapshotStatusChanged, object: nil, userInfo: info)
    }
    nonisolated static func date(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
    nonisolated static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    nonisolated private static func read(_ url: URL, limit: Int) throws -> Data {
        let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
        guard size > 0, size <= limit else { throw DiscoverySnapshotError.invalidData }
        return try Data(contentsOf: url)
    }
    nonisolated static func decodePart(_ data: Data, descriptor: DiscoverySnapshotManifest.Part) throws -> DiscoverySnapshotPart {
        guard data.count == descriptor.bytes, hash(data) == descriptor.sha256 else { throw DiscoverySnapshotError.invalidData }
        let part = try JSONDecoder().decode(DiscoverySnapshotPart.self, from: data)
        guard part.schemaVersion == 1,
              part.festivals.count + part.performanceEvents.count + part.localEvents.count == descriptor.count,
              part.festivals.allSatisfy({ validCoordinate($0.lat, $0.lng) }),
              (part.performanceEvents + part.localEvents).allSatisfy({ validCoordinate($0.lat, $0.lng) }),
              part.localEvents.allSatisfy({ $0.status == .approved }) else { throw DiscoverySnapshotError.invalidData }
        return part
    }
    nonisolated private static func validCoordinate(_ lat: Double, _ lng: Double) -> Bool {
        lat.isFinite && lng.isFinite && abs(lat) <= 90 && abs(lng) <= 180 && (lat != 0 || lng != 0)
    }
}
