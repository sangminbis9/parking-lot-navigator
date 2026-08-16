import SwiftUI

@MainActor
final class PipelineDashboardViewModel: ObservableObject {
    @Published var stats: PipelineStats?
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    func load() async {
        do {
            stats = try await apiClient.pipelineStats()
            errorMessage = nil
        } catch {
            errorMessage = "파이프라인 통계를 불러오지 못했습니다."
        }
    }
}

struct PipelineDashboardView: View {
    @StateObject private var viewModel: PipelineDashboardViewModel

    init(apiClient: APIClientProtocol) {
        _viewModel = StateObject(wrappedValue: PipelineDashboardViewModel(apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let stats = viewModel.stats {
                    todayCard(stats)
                    discoveryIngestionCard(stats.discoveryItems)
                    taggingQueueCard(stats.discoveryItems)
                    feeQueueCard(stats.discoveryItems)
                    backfillQueueCard(stats.discoveryItems)
                    discoveryInventoryCard(stats.discoveryItems)
                    localEventsCard(stats.localEvents)
                    scraperCard(stats)
                    syncActivityCard(stats.syncActivity)
                    syncRunsCard(stats.recentSyncRuns)
                    generatedAtNote(stats.generatedAt)
                } else if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.festival(.subheadline))
                        .foregroundStyle(FestivalDesign.coralText)
                        .padding(14)
                        .festivalCard()
                } else {
                    LoadingStateView(text: "파이프라인 통계를 불러오는 중입니다")
                        .frame(height: 160)
                }
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("파이프라인 대시보드")
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
    }

    // MARK: 최근 24시간 요약

    private func todayCard(_ stats: PipelineStats) -> some View {
        let sync = stats.syncActivity
        let failures = sync.last24h.failed + sync.last24h.timeout
        return VStack(alignment: .leading, spacing: 10) {
            Text("최근 24시간")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            HStack(spacing: 8) {
                statTile("새 축제·공연", stats.discoveryItems.ingestion.newLast24h, tint: FestivalDesign.coral)
                statTile("새 로컬 이벤트", stats.localEvents.ingestion.newLast24h, tint: FestivalDesign.teal)
            }
            HStack(spacing: 8) {
                statTile("sync 실행", sync.last24h.runs, tint: FestivalDesign.parkingBlue)
                statTile(
                    "실패·타임아웃",
                    failures,
                    tint: failures > 0 ? FestivalDesign.coral : FestivalDesign.secondaryText
                )
            }

            if sync.running > 0 {
                statRow(title: "진행 중인 sync", value: sync.running)
            }
            timeRow(title: "마지막 sync 성공", iso: sync.lastSuccessAt)
            timeRow(title: "마지막 신규 유입", iso: stats.discoveryItems.ingestion.latestFirstSeenAt)
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 축제·공연 신규 유입

    private func discoveryIngestionCard(_ section: PipelineStats.DiscoveryItemsSection) -> some View {
        let ingestion = section.ingestion
        return VStack(alignment: .leading, spacing: 10) {
            Text("신규 유입 (축제·공연)")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            DailyNewChart(entries: ingestion.dailyNew)

            statRow(title: "최근 24시간 신규", value: ingestion.newLast24h)
            statRow(title: "최근 7일 신규", value: ingestion.newLast7d)
            statRow(title: "최근 24시간 갱신 확인", value: ingestion.refreshedLast24h, suffix: "/\(section.total)")
            statRow(title: "7일 넘게 미갱신(진행·예정)", value: ingestion.staleOver7d)
            statRow(title: "7일 넘게 미갱신(종료됨)", value: ingestion.staleEndedOver7d)
            statRow(title: "좌표 없음(0,0)", value: ingestion.missingCoordinates)
            timeRow(title: "마지막 sync 기록", iso: ingestion.latestSyncedAt)

            if !ingestion.newBySourceLast7d.isEmpty {
                breakdownRow(
                    title: "7일 신규 소스별",
                    entries: ingestion.newBySourceLast7d.map { ($0.source, $0.count) }
                )
            }
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 카테고리 태깅 큐

    private func taggingQueueCard(_ section: PipelineStats.DiscoveryItemsSection) -> some View {
        let tagging = section.tagging
        return VStack(alignment: .leading, spacing: 10) {
            Text("카테고리 태깅 큐")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            HStack(spacing: 8) {
                statPill("LLM", tagging.llmTagged, tint: FestivalDesign.teal)
                statPill("폴백", tagging.fallbackTagged, tint: FestivalDesign.lantern)
                statPill("대기", tagging.pending, tint: tagging.pending > 0 ? FestivalDesign.coral : FestivalDesign.secondaryText)
            }

            Text("폴백은 LLM 응답 없이 결정론적 패턴으로 붙인 분류다(tagging_version = -1). 대기는 20분 주기 cron이 순차 처리한다.")
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)

            timeRow(title: "가장 오래 대기 중", iso: tagging.oldestPendingFirstSeenAt)
            timeRow(title: "마지막 태깅", iso: tagging.lastTaggedAt)

            if !tagging.byModel.isEmpty {
                breakdownRow(title: "모델별", entries: tagging.byModel.map { ($0.model, $0.count) })
            }
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 요금 backfill 큐

    private func feeQueueCard(_ section: PipelineStats.DiscoveryItemsSection) -> some View {
        let fee = section.feeCoverage
        return VStack(alignment: .leading, spacing: 10) {
            Text("요금 backfill 큐")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            HStack(spacing: 8) {
                statPill("무료", fee.free, tint: FestivalDesign.teal)
                statPill("유료", fee.paid, tint: FestivalDesign.coral)
                statPill("모름", fee.unknown, tint: FestivalDesign.secondaryText)
                statPill("미확인", fee.unchecked, tint: FestivalDesign.secondaryText.opacity(0.6))
            }

            statRow(title: "최근 24시간 확인", value: section.fee.checkedLast24h)
            if fee.unchecked > 0 {
                statRow(title: "남은 큐 소진 예상", value: backfillHours(fee.unchecked, perRun: 30), suffix: "시간")
            }
            timeRow(title: "가장 오래된 미확인", iso: section.fee.oldestUncheckedFirstSeenAt)
            timeRow(title: "마지막 확인", iso: section.fee.lastCheckedAt)

            Text("매시 :00에 30건씩 처리한다(subrequest 50건 한도).")
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 좌표·사진 backfill 큐

    private func backfillQueueCard(_ section: PipelineStats.DiscoveryItemsSection) -> some View {
        let backfill = section.backfill
        return VStack(alignment: .leading, spacing: 10) {
            Text("좌표·사진 backfill 큐")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            HStack(spacing: 8) {
                statPill("좌표 남음", backfill.geocodePending, tint: FestivalDesign.coral)
                statPill("사진 남음", backfill.imagePending, tint: FestivalDesign.teal)
            }

            statRow(title: "좌표 최근 24시간", value: backfill.geocodeCheckedLast24h)
            if backfill.geocodePending > 0 {
                statRow(
                    title: "좌표 소진 예상",
                    value: backfillHours(backfill.geocodePending, perRun: 25),
                    suffix: "시간"
                )
            }
            timeRow(title: "좌표 마지막 실행", iso: backfill.geocodeLastCheckedAt)

            statRow(title: "사진 최근 24시간", value: backfill.imageCheckedLast24h)
            if backfill.imagePending > 0 {
                statRow(
                    title: "사진 소진 예상",
                    value: backfillHours(backfill.imagePending, perRun: 30),
                    suffix: "시간"
                )
            }
            timeRow(title: "사진 마지막 실행", iso: backfill.imageLastCheckedAt)

            Text("좌표는 매시 :20, 사진은 매시 :40에 실행한다. 최근 24시간이 0인데 남은 건수가 그대로면 회차가 죽고 있다는 뜻이다.")
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 축제·공연 재고

    private func discoveryInventoryCard(_ section: PipelineStats.DiscoveryItemsSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("축제·공연 (discovery_items)", total: section.total)
            breakdownRow(title: "소스별", entries: section.bySource.map { ($0.source, $0.count) })
            breakdownRow(title: "유형별", entries: section.byType.map { ($0.type, $0.count) })
            breakdownRow(title: "상태별", entries: section.byStatus.map { ($0.status, $0.count) })
            breakdownRow(title: "카테고리별", entries: section.byPrimaryCategory.map { ($0.category, $0.count) })
            coverageRow(title: "태깅 완료", coverage: section.taggingCoverage)
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 로컬 이벤트

    private func localEventsCard(_ section: PipelineStats.LocalEventsSection) -> some View {
        let ingestion = section.ingestion
        return VStack(alignment: .leading, spacing: 10) {
            sectionHeader("로컬 이벤트 (local_events)", total: section.total)

            DailyNewChart(entries: ingestion.dailyNew)

            statRow(title: "최근 24시간 신규", value: ingestion.newLast24h)
            statRow(title: "최근 7일 신규", value: ingestion.newLast7d)
            statRow(title: "최근 7일 승인", value: ingestion.approvedLast7d)
            if let confidence = ingestion.averageConfidence {
                HStack {
                    Text("평균 신뢰도 점수")
                        .font(.festival(.subheadline))
                        .foregroundStyle(FestivalDesign.navy)
                    Spacer()
                    Text(String(format: "%.2f", confidence))
                        .font(.festival(.subheadline, weight: .semibold))
                        .foregroundStyle(FestivalDesign.secondaryText)
                }
            }
            statRow(title: "검토 필요", value: section.needsReview)
            timeRow(title: "가장 오래 대기 중", iso: ingestion.oldestPendingCreatedAt)
            timeRow(title: "마지막 수집", iso: ingestion.latestCreatedAt)

            breakdownRow(title: "상태별", entries: section.byStatus.map { ($0.status, $0.count) })
            breakdownRow(title: "유형별", entries: section.byEventType.map { ($0.eventType, $0.count) })
            breakdownRow(title: "소스별", entries: section.bySource.map { ($0.source, $0.count) })
            coverageRow(title: "태깅 완료", coverage: section.taggingCoverage)
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 스크래핑 소스

    private func scraperCard(_ stats: PipelineStats) -> some View {
        let city = stats.cityFestivals
        let akei = stats.akeiTradeExpos
        return VStack(alignment: .leading, spacing: 10) {
            Text("스크래핑 원본 테이블")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            VStack(alignment: .leading, spacing: 6) {
                sectionHeader("시/군 축제 (city_festivals)", total: city.total)
                statRow(title: "좌표 확인 완료", value: city.geocodeChecked)
                statRow(title: "좌표 미확인", value: city.geocodeUnchecked)
                statRow(title: "진행 중/예정", value: city.upcoming)
                statRow(title: "종료됨", value: city.ended)
                statRow(title: "최근 24시간 스크랩", value: city.scrapedLast24h)
                timeRow(title: "마지막 스크랩", iso: city.lastScrapedAt)
            }
            .padding(10)
            .background(FestivalDesign.cream.opacity(0.35))
            .clipShape(FestivalDesign.controlShape)

            VStack(alignment: .leading, spacing: 6) {
                sectionHeader("무역박람회 (akei_trade_expos)", total: akei.total)
                statRow(title: "진행 중/예정", value: akei.upcoming)
                statRow(title: "최근 24시간 스크랩", value: akei.scrapedLast24h)
                timeRow(title: "마지막 스크랩", iso: akei.lastScrapedAt)
            }
            .padding(10)
            .background(FestivalDesign.cream.opacity(0.35))
            .clipShape(FestivalDesign.controlShape)

            Text("이 두 테이블은 스크래핑 결과 원본이고, 앱에 노출되려면 provider 청크 로테이션이 discovery_items로 옮겨야 한다.")
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .padding(14)
        .festivalCard()
    }

    // MARK: 동기화 활동

    private func syncActivityCard(_ section: PipelineStats.SyncActivitySection) -> some View {
        let totals = section.last24h
        return VStack(alignment: .leading, spacing: 10) {
            Text("동기화 활동 (최근 24시간)")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            HStack(spacing: 8) {
                statPill("성공", totals.success, tint: FestivalDesign.teal)
                statPill("실패", totals.failed, tint: totals.failed > 0 ? FestivalDesign.coral : FestivalDesign.secondaryText)
                statPill("타임아웃", totals.timeout, tint: totals.timeout > 0 ? FestivalDesign.lantern : FestivalDesign.secondaryText)
                statPill("진행 중", section.running, tint: FestivalDesign.parkingBlue)
            }

            statRow(title: "수집(fetched)", value: totals.fetched)
            statRow(title: "반영(upserted)", value: totals.upserted)
            statRow(title: "스킵(skipped)", value: totals.skipped)
            statRow(title: "정리(pruned)", value: totals.pruned)

            if section.byType.isEmpty {
                Text("최근 24시간 실행 없음")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }

            ForEach(section.byType) { row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top) {
                        Text(row.syncType)
                            .font(.festival(.caption, weight: .semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(
                            text: "\(row.runs)회",
                            kind: row.failed + row.timeout > 0 ? .warning : .source
                        )
                    }
                    Text("성공 \(row.success) · 실패 \(row.failed) · 타임아웃 \(row.timeout) · 수집 \(row.fetched) · 반영 \(row.upserted)")
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    if let last = row.lastStartedAt {
                        Text("마지막 실행 \(Self.relativeText(last))")
                            .font(.festival(.caption))
                            .foregroundStyle(FestivalDesign.secondaryText)
                    }
                }
                .padding(10)
                .background(FestivalDesign.cream.opacity(0.35))
                .clipShape(FestivalDesign.controlShape)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func syncRunsCard(_ runs: [PipelineStats.SyncRun]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("최근 동기화 이력 (discovery sync)")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)

            if runs.isEmpty {
                Text("이력 없음")
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.secondaryText)
            }

            ForEach(runs) { run in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top) {
                        Text(run.syncType)
                            .font(.festival(.subheadline, weight: .semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(text: run.status, kind: run.status == "success" ? .realtime : .warning)
                    }
                    Text("수집 \(run.fetched) · 반영 \(run.upserted) · 스킵 \(run.skipped) · 정리 \(run.pruned)")
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    Text(Self.runTimingText(run))
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    if let message = run.message {
                        Text(message)
                            .font(.festival(.caption))
                            .foregroundStyle(FestivalDesign.coralText)
                    }
                }
                .padding(10)
                .background(FestivalDesign.cream.opacity(0.35))
                .clipShape(FestivalDesign.controlShape)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func generatedAtNote(_ generatedAt: String) -> some View {
        Text("조회 시각 \(generatedAt)")
            .font(.festival(.caption))
            .foregroundStyle(FestivalDesign.secondaryText)
    }

    // MARK: 공용 조각

    private func sectionHeader(_ title: String, total: Int) -> some View {
        HStack {
            Text(title)
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
            Spacer()
            StatusBadge(text: "총 \(total)건", kind: .source)
        }
    }

    private func breakdownRow(title: String, entries: [(String, Int)]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            FlowWrapText(entries: entries)
        }
    }

    private func coverageRow(title: String, coverage: PipelineStats.Coverage) -> some View {
        statRow(title: title, value: coverage.tagged, suffix: "/\(coverage.total)")
    }

    private func statRow(title: String, value: Int, suffix: String = "") -> some View {
        HStack {
            Text(title)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
            Spacer()
            Text("\(value)\(suffix)")
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
    }

    /// ISO 시각은 그대로 보면 읽기 어려워 "3시간 전"으로 환산해 보여준다.
    private func timeRow(title: String, iso: String?) -> some View {
        HStack {
            Text(title)
                .font(.festival(.subheadline))
                .foregroundStyle(FestivalDesign.navy)
            Spacer()
            Text(Self.relativeText(iso))
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
    }

    private func statTile(_ title: String, _ value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(value)")
                .font(.festival(.title3, weight: .bold))
                .foregroundStyle(FestivalDesign.readable(tint))
            Text(title)
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(tint.opacity(0.14))
        .clipShape(FestivalDesign.controlShape)
    }

    private func statPill(_ title: String, _ value: Int, tint: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.festival(.subheadline, weight: .bold))
                .foregroundStyle(FestivalDesign.readable(tint))
            Text(title)
                .font(.festival(.caption))
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(tint.opacity(0.14))
        .clipShape(FestivalDesign.controlShape)
    }

    /// 남은 건수를 예상 소진 시간(시)으로 바꾼다. 요금·좌표·사진 backfill은
    /// `*/20` cron의 분 슬롯을 나눠 쓰므로 각각 시간당 1회씩만 돈다.
    private func backfillHours(_ pending: Int, perRun: Int) -> Int {
        guard perRun > 0 else { return 0 }
        return Int((Double(pending) / Double(perRun)).rounded(.up))
    }

    private static func runTimingText(_ run: PipelineStats.SyncRun) -> String {
        let started = relativeText(run.startedAt)
        guard
            let start = parseDate(run.startedAt),
            let finishedAt = run.finishedAt,
            let finish = parseDate(finishedAt)
        else {
            return "시작 \(started)"
        }
        return "시작 \(started) · 소요 \(Int(finish.timeIntervalSince(start)))초"
    }

    static func relativeText(_ iso: String?) -> String {
        guard let iso, let date = parseDate(iso) else { return "기록 없음" }
        let seconds = Date().timeIntervalSince(date)
        if seconds < 60 { return "방금 전" }
        if seconds < 3600 { return "\(Int(seconds / 60))분 전" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))시간 전" }
        return "\(Int(seconds / 86_400))일 전"
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoPlain = ISO8601DateFormatter()

    private static func parseDate(_ iso: String) -> Date? {
        isoFractional.date(from: iso) ?? isoPlain.date(from: iso)
    }
}

/// 최근 7일 일별 신규 건수 막대. 값이 없는 날도 0으로 채워 추세가 끊겨 보이지 않게 한다.
private struct DailyNewChart: View {
    let entries: [PipelineStats.DailyCount]

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    private var days: [(label: String, count: Int)] {
        let lookup = Dictionary(entries.map { ($0.date, $0.count) }, uniquingKeysWith: { $1 })
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let today = Date()
        return (0..<7).reversed().compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            let key = Self.dayFormatter.string(from: date)
            return (label: String(key.suffix(2)), count: lookup[key] ?? 0)
        }
    }

    var body: some View {
        let values = days
        let maxCount = max(values.map(\.count).max() ?? 0, 1)
        VStack(alignment: .leading, spacing: 6) {
            Text("최근 7일 신규 (UTC 기준)")
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, day in
                    VStack(spacing: 3) {
                        Text("\(day.count)")
                            .font(.festival(size: 10, weight: .semibold))
                            .foregroundStyle(FestivalDesign.secondaryText)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(day.count > 0 ? FestivalDesign.teal : FestivalDesign.creamDeep)
                            .frame(height: max(4, 52 * CGFloat(day.count) / CGFloat(maxCount)))
                        Text(day.label)
                            .font(.festival(size: 10))
                            .foregroundStyle(FestivalDesign.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 84, alignment: .bottom)
        }
    }
}

private struct FlowWrapText: View {
    let entries: [(String, Int)]

    var body: some View {
        HStack {
            Text(entries.map { "\($0.0) \($0.1)" }.joined(separator: " · "))
                .font(.festival(.caption, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}
