import SwiftUI

struct ProviderStatusView: View {
    let apiClient: APIClientProtocol
    @State private var providers: [ProviderHealth] = []
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                apiServerCard
                providerStatusCard
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .festivalNavigationTitle("Provider 상태")
        .task { await load() }
        .refreshable { await load() }
    }

    private var apiServerCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("API 서버")
                .font(.festival(.headline))
                .foregroundStyle(FestivalDesign.navy)
            Text(AppConfiguration.current.apiBaseURL.absoluteString)
                .font(.festival(.subheadline, weight: .semibold))
                .foregroundStyle(FestivalDesign.navy)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(FestivalDesign.cream.opacity(0.35))
                .clipShape(FestivalDesign.controlShape)
        }
        .padding(14)
        .festivalCard()
    }

    private var providerStatusCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Provider 상태")
                    .font(.festival(.headline))
                    .foregroundStyle(FestivalDesign.navy)
                Spacer()
                StatusBadge(text: "\(providers.count)개", kind: .source)
            }

            if providers.isEmpty && errorMessage == nil {
                LoadingStateView(text: "provider 상태를 확인하는 중입니다")
                    .frame(height: 90)
            }

            ForEach(providers) { provider in
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .top) {
                        Text(provider.name)
                            .font(.festival(.subheadline, weight: .semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(text: provider.status, kind: provider.status == "up" ? .realtime : .warning)
                    }
                    Text("품질 점수 \(provider.qualityScore, specifier: "%.2f")")
                        .font(.festival(.caption))
                        .foregroundStyle(FestivalDesign.secondaryText)
                    if let error = provider.lastError {
                        Text(error)
                            .font(.festival(.caption))
                            .foregroundStyle(FestivalDesign.coralText)
                    }
                }
                .padding(10)
                .background(FestivalDesign.cream.opacity(0.35))
                .clipShape(FestivalDesign.controlShape)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.festival(.subheadline))
                    .foregroundStyle(FestivalDesign.coralText)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func load() async {
        do {
            providers = try await apiClient.providerHealth()
        } catch {
            errorMessage = "provider 상태를 불러오지 못했습니다."
        }
    }
}
