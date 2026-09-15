import Foundation
import XCTest
@testable import ParkingLotNavigator

final class DiscoverySnapshotTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-09-13T01:00:00Z")!
    private var directories: [URL] = []

    override func tearDown() {
        for directory in directories { try? FileManager.default.removeItem(at: directory) }
        directories = []
        super.tearDown()
    }
    private func directory() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("snapshot-test-\(UUID().uuidString)")
        directories.append(url)
        return url
    }
    private func festival(_ id: String, lat: Double = 37.41, lng: Double = 126.64,
                          start: String = "2026-09-13", end: String = "2026-09-30") -> Festival {
        Festival(id: id, title: id, subtitle: nil, startDate: start, endDate: end, status: .upcoming,
                 venueName: nil, address: "인천", lat: lat, lng: lng, distanceMeters: 999999,
                 source: "test", sourceUrl: nil, imageUrl: nil, tags: [])
    }
    private func merchantEvent(_ id: String, start: String, end: String?, paidUntil: String) -> FreeEvent {
        FreeEvent(id: id, title: id, eventType: "discount", category: "local_event", sourceId: id,
                  startDate: start, endDate: end, status: .approved, storeName: "테스트 매장", venueName: "테스트 매장",
                  address: "인천", lat: 37.41, lng: 126.64, distanceMeters: 999999, source: "merchant",
                  sourceUrl: nil, imageUrl: nil, benefit: "10% 할인", shortDescription: nil, region: nil,
                  updatedAt: nil, confidenceScore: nil, needsReview: false, isSponsored: true,
                  sponsorTier: nil, paidUntil: paidUntil, priorityScore: 100)
    }
    private func release(_ items: [Festival], generated: String = "2026-09-13T00:00:00.000Z") throws -> (Data, [String: Data]) {
        var files: [String: Data] = [:]
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var descriptors: [DiscoverySnapshotManifest.Part] = []
        for start in stride(from: 0, to: items.count, by: 128) {
            let part = DiscoverySnapshotPart(schemaVersion: 1, festivals: Array(items[start..<min(items.count, start + 128)]), performanceEvents: [], localEvents: [])
            let data = try encoder.encode(part)
            let hash = DiscoverySnapshotStore.hash(data)
            files["\(hash).json"] = data
            descriptors.append(.init(sha256: hash, bytes: data.count, count: part.festivals.count))
        }
        let manifest = DiscoverySnapshotManifest(schemaVersion: 1, version: UUID().uuidString,
            generatedAt: generated, parts: descriptors, count: items.count)
        return (try JSONEncoder().encode(manifest), files)
    }
    private func store(_ directory: URL, transport: SnapshotTestTransport) -> DiscoverySnapshotStore {
        DiscoverySnapshotStore(baseURL: URL(string: "https://snapshot.test/discovery/v1/")!, directory: directory,
            now: { self.now }, loader: { url, limit, etag in try await transport.load(url, limit: limit, etag: etag) })
    }

    func testManyPinsAndMapPanningDoNotMakeNewNetworkRequests() async throws {
        let items = (0..<750).map { festival("id-\($0)") } + [festival("busan", lat: 35.18, lng: 129.07)]
        let release = try release(items)
        let transport = SnapshotTestTransport(manifest: release.0, parts: release.1)
        let store = store(directory(), transport: transport)
        let nearby = try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertEqual(nearby.count, 750)
        XCTAssertTrue(nearby.allSatisfy { $0.distanceMeters == 0 && $0.status == .ongoing })
        let before = await transport.requests
        let busan = try await store.festivals(lat: 35.18, lng: 129.07, radius: 20000, upcoming: 365)
        XCTAssertEqual(busan.map(\.id), ["busan"])
        let after = await transport.requests
        XCTAssertEqual(before, after)
        await transport.setOffline(true)
        let returned = try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertEqual(Set(returned.map(\.id)), Set(nearby.map(\.id)))
        let afterReturn = await transport.requests
        XCTAssertEqual(before, afterReturn, "저장된 핀은 다른 지역을 거쳐 돌아와도 재다운로드하지 않는다")
    }

    func testSettingsStatusDoesNotDownloadOnFirstUse() async throws {
        let release = try release([festival("one")])
        let transport = SnapshotTestTransport(manifest: release.0, parts: release.1)
        let store = store(directory(), transport: transport)
        let status = await store.currentStatus()
        XCTAssertNil(status.generatedAt)
        XCTAssertFalse(status.isUpdating)
        XCTAssertFalse(status.refreshFailed)
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
    }

    func testSettingsStatusRestoresDiskTimestampWithoutNetworkAndPreservesItOnFailure() async throws {
        let release = try release([festival("saved")])
        let transport = SnapshotTestTransport(manifest: release.0, parts: release.1)
        let directory = directory()
        let first = store(directory, transport: transport)
        try await first.refreshNow()
        let before = await transport.requests
        await transport.setOffline(true)
        let relaunched = store(directory, transport: transport)
        let restored = await relaunched.currentStatus()
        XCTAssertEqual(restored.generatedAt, DiscoverySnapshotStore.date("2026-09-13T00:00:00Z"))
        XCTAssertFalse(restored.isUpdating)
        let after = await transport.requests
        XCTAssertEqual(before, after, "설정을 여는 동작은 서버 조회를 시작하면 안 된다")
        do { try await relaunched.refreshNow(); XCTFail("offline") } catch {}
        let failed = await relaunched.currentStatus()
        XCTAssertEqual(failed.generatedAt, restored.generatedAt)
        XCTAssertTrue(failed.refreshFailed)
        XCTAssertFalse(failed.isUpdating)
    }

    func testSettingsTimestampUsesKoreanTimeAndDistinguishesMissingData() {
        var status = DiscoverySnapshotStatus()
        XCTAssertEqual(status.referenceTimeText, "아직 저장된 행사 데이터가 없어요")
        status.generatedAt = DiscoverySnapshotStore.date("2026-09-13T00:00:00Z")
        XCTAssertEqual(status.referenceTimeText, "2026년 9월 13일 09:00 기준 (한국 시간)")
        status.refreshFailed = true
        XCTAssertTrue(status.detailText.contains("저장된 행사"))
        status.isUpdating = true
        XCTAssertEqual(status.detailText, "행사 데이터 업데이트 중")
    }

    func testPeriodicCheckSharesCooldownAndPreservesOfflineData() async throws {
        let release = try release([festival("saved")])
        let transport = SnapshotTestTransport(manifest: release.0, parts: release.1)
        let store = store(directory(), transport: transport)
        try await store.refreshIfDue()
        let before = await transport.requests
        for _ in 0..<10 { try await store.refreshIfDue() }
        let after = await transport.requests
        XCTAssertEqual(before, after)
        await transport.setOffline(true)
        do { _ = try await store.refreshNow(); XCTFail("offline") } catch {}
        let failed = await transport.requests
        try await store.refreshIfDue()
        let cooled = await transport.requests
        XCTAssertEqual(failed, cooled)
    }

    func testConcurrentLayersShareOneDownloadAndCancellationDoesNotCancelOtherConsumers() async throws {
        let release = try release([festival("one")])
        let transport = SnapshotTestTransport(manifest: release.0, parts: release.1)
        let store = store(directory(), transport: transport)
        let cancelled = Task { try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365) }
        cancelled.cancel()
        async let events = store.events(lat: 37.41, lng: 126.64, radius: 20000)
        async let festivals = store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        let (_, items) = try await (events, festivals)
        _ = try? await cancelled.value
        XCTAssertEqual(items.count, 1)
        let requests = await transport.requests
        XCTAssertEqual(requests.filter { $0 == "manifest.json" }.count, 1)
        XCTAssertEqual(requests.count, 2)
    }

    func testDiskCacheSurvivesRelaunchAndServerFailure() async throws {
        let release = try release([festival("saved")])
        let transport = SnapshotTestTransport(manifest: release.0, parts: release.1)
        let directory = directory()
        let first = store(directory, transport: transport)
        _ = try await first.refreshNow()
        await transport.setOffline(true)
        let second = store(directory, transport: transport)
        let saved = try await second.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertEqual(saved.map(\.id), ["saved"])
        do { _ = try await second.refreshNow(); XCTFail("offline refresh must fail") } catch {}
        let stillSaved = try await second.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertEqual(stillSaved.map(\.id), ["saved"])
    }

    func testFailedPartNeverReplacesManifestAndCompletedUpdateRemovesDeletedPins() async throws {
        let old = try release([festival("removed"), festival("kept")])
        let next = try release([festival("kept")], generated: "2026-09-13T01:00:00.000Z")
        let transport = SnapshotTestTransport(manifest: old.0, parts: old.1)
        let directory = directory()
        let store = store(directory, transport: transport)
        _ = try await store.refreshNow()
        await transport.replace(manifest: next.0, parts: [:])
        do { _ = try await store.refreshNow(); XCTFail("missing part must fail") } catch {}
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("manifest.json")), old.0)
        let retained = try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertEqual(retained.count, 2)
        await transport.replace(manifest: next.0, parts: next.1)
        _ = try await store.refreshNow()
        let current = try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertEqual(current.map(\.id), ["kept"])
    }

    func testUnchangedPartsAreReusedAcrossNewManifestVersions() async throws {
        let old = try release([festival("same")])
        let next = try release([festival("same")], generated: "2026-09-13T01:00:00.000Z")
        let transport = SnapshotTestTransport(manifest: old.0, parts: old.1)
        let store = store(directory(), transport: transport)
        _ = try await store.refreshNow()
        await transport.replace(manifest: next.0, parts: [:])
        _ = try await store.refreshNow()
        let requests = await transport.requests
        XCTAssertEqual(requests.filter { $0 != "manifest.json" }.count, 1)
    }

    func testDigestAndCountValidationRejectsBrokenData() throws {
        let release = try release([festival("one")])
        let manifest = try JSONDecoder().decode(DiscoverySnapshotManifest.self, from: release.0)
        let descriptor = manifest.parts[0]
        XCTAssertThrowsError(try DiscoverySnapshotStore.decodePart(Data("corrupted".utf8), descriptor: descriptor))
        let bytes = release.1["\(descriptor.sha256).json"]!
        XCTAssertThrowsError(try DiscoverySnapshotStore.decodePart(bytes, descriptor: .init(sha256: descriptor.sha256, bytes: bytes.count, count: 2)))
    }

    func testEmptyReleaseAndUnknownSchemaAreDistinguishable() async throws {
        let release = try release([])
        let transport = SnapshotTestTransport(manifest: release.0, parts: [:])
        let store = store(directory(), transport: transport)
        let empty = try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365)
        XCTAssertTrue(empty.isEmpty)
        let invalid = DiscoverySnapshotManifest(schemaVersion: 2, version: UUID().uuidString, generatedAt: "2026-09-13T00:00:00Z", parts: [], count: 0)
        XCTAssertThrowsError(try invalid.validate())
    }

    func testOfflineFirstUseHasCooldownInsteadOfPanRetryStorm() async throws {
        let release = try release([])
        let transport = SnapshotTestTransport(manifest: release.0, parts: [:])
        await transport.setOffline(true)
        let store = store(directory(), transport: transport)
        for _ in 0..<10 {
            do { _ = try await store.festivals(lat: 37.41, lng: 126.64, radius: 20000, upcoming: 365); XCTFail("must fail") } catch {}
        }
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 1)
    }

    func testKoreanMidnightExpirationUnknownDatesAndSpatialCellBoundary() {
        let index = DiscoverySnapshotIndex(parts: [.init(schemaVersion: 1, festivals: [
            festival("ended", end: "2026-09-12"), festival("today"),
            festival("unknown", start: "", end: ""), festival("edge", lat: 37.50001),
        ], performanceEvents: [], localEvents: [])])
        let atMidnight = ISO8601DateFormatter().date(from: "2026-09-12T15:00:00Z")!
        let current = index.festivals(lat: 37.49999, lng: 126.64, radius: 20000, upcoming: 365, past: 0, now: atMidnight)
        XCTAssertEqual(Set(current.map(\.id)), ["today", "unknown", "edge"])
        XCTAssertEqual(current.first(where: { $0.id == "today" })?.status, .ongoing)
        let past = index.festivals(lat: 37.49999, lng: 126.64, radius: 20000, upcoming: 365, past: 1, now: atMidnight)
        XCTAssertEqual(past.count, 4)
    }

    func testMerchantReversedDatesUsePaidPeriodWithoutRevivingNormallyExpiredEvents() {
        let malformed = merchantEvent("merchant-malformed", start: "2026-09-15", end: "2026-05-21", paidUntil: "2026-12-15")
        let expired = merchantEvent("merchant-expired", start: "2026-05-18", end: "2026-05-21", paidUntil: "2026-12-15")
        let index = DiscoverySnapshotIndex(parts: [.init(schemaVersion: 1, festivals: [], performanceEvents: [], localEvents: [malformed, expired])])
        let now = ISO8601DateFormatter().date(from: "2026-09-15T03:00:00Z")!

        XCTAssertEqual(index.events(lat: 37.41, lng: 126.64, radius: 20_000, now: now).map(\.id), ["merchant-malformed"])
    }
}

private actor SnapshotTestTransport {
    private var manifest: Data
    private var parts: [String: Data]
    private var offline = false
    private(set) var requests: [String] = []
    init(manifest: Data, parts: [String: Data]) { self.manifest = manifest; self.parts = parts }
    func replace(manifest: Data, parts: [String: Data]) { self.manifest = manifest; self.parts = parts }
    func setOffline(_ value: Bool) { offline = value }
    func load(_ url: URL, limit: Int, etag: String?) throws -> DiscoverySnapshotDownload {
        requests.append(url.lastPathComponent)
        if offline { throw URLError(.notConnectedToInternet) }
        if url.lastPathComponent == "manifest.json" { return .init(data: manifest, statusCode: 200, etag: nil) }
        guard let data = parts[url.lastPathComponent] else { return .init(data: Data(), statusCode: 404, etag: nil) }
        return .init(data: data, statusCode: 200, etag: nil)
    }
}
