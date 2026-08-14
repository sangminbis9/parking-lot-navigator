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
                    discoveryCard(stats.discoveryItems)
                    localEventsCard(stats.localEvents)
                    cityFestivalsCard(stats.cityFestivals)
                    akeiCard(stats.akeiTradeExpos)
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

    private func discoveryCard(_ section: PipelineStats.DiscoveryItemsSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("축제·공연 (discovery_items)", total: section.total)
            breakdownRow(title: "소스별", entries: section.bySource.map { ($0.source, $0.count) })
            breakdownRow(title: "유형별", entries: section.byType.map { ($0.type, $0.count) })
            coverageRow(title: "태깅 완료", coverage: section.taggingCoverage)
            HStack(spacing: 8) {
                statPill("무료", section.feeCoverage.free, tint: FestivalDesign.teal)
                statPill("유료", section.feeCoverage.paid, tint: FestivalDesign.coral)
                statPill("모름", section.feeCoverage.unknown, tint: FestivalDesign.secondaryText)
                statPill("미확인", section.feeCoverage.unchecked, tint: FestivalDesign.secondaryText.opacity(0.6))
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func localEventsCard(_ section: PipelineStats.LocalEventsSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("로컬 이벤트 (local_events)", total: section.total)
            breakdownRow(title: "상태별", entries: section.byStatus.map { ($0.status, $0.count) })
            breakdownRow(title: "소스별", entries: section.bySource.map { ($0.source, $0.count) })
            coverageRow(title: "태깅 완료", coverage: section.taggingCoverage)
            statRow(title: "검토 필요", value: section.needsReview)
        }
        .padding(14)
        .festivalCard()
    }

    private func cityFestivalsCard(_ section: PipelineStats.CityFestivalsSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("시/군 스크래핑 축제 (city_festivals)", total: section.total)
            statRow(title: "좌표 확인 완료", value: section.geocodeChecked)
            statRow(title: "좌표 미확인", value: section.geocodeUnchecked)
            statRow(title: "진행 중/예정", value: section.upcoming)
            statRow(title: "종료됨", value: section.ended)
        }
        .padding(14)
        .festivalCard()
    }

    private func akeiCard(_ section: PipelineStats.AkeiTradeExposSection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("무역박람회 (akei_trade_expos)", total: section.total)
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
                    HStack {
                        Text(run.syncType)
                            .font(.festival(.subheadline, weight: .semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(text: run.status, kind: run.status == "success" ? .realtime : .warning)
                    }
                    Text("수집 \(run.fetched) · 반영 \(run.upserted) · 스킵 \(run.skipped) · 정리 \(run.pruned)")
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    Text(run.startedAt)
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

    private func sectionHeader(_ title: String, total: Int) -> some View {
        HStack {
            Text(title)
                .font(.festival(.headline))
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
