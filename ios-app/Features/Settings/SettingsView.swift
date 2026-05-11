import SwiftUI

struct SettingsView: View {
    let apiClient: APIClientProtocol
    @State private var providers: [ProviderHealth] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    settingsHeader
                    appSettingsCard
                    dataSourceCard
                    providerStatusCard
                }
                .padding(16)
            }
            .background(FestivalDesign.background.ignoresSafeArea())
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
        }
    }

    private var settingsHeader: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 62, height: 62)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("앱 안내와 데이터 상태")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("축제 탐색과 주차 추천에 쓰이는 연결 정보를 확인합니다.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FestivalDesign.tealSoft, FestivalDesign.cream.opacity(0.78)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.cardRadius))
        .overlay(
            RoundedRectangle(cornerRadius: FestivalDesign.cardRadius)
                .stroke(FestivalDesign.creamDeep.opacity(0.45), lineWidth: 1)
        )
    }

    private var appSettingsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("앱 설정")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            settingRow("API 서버", AppConfiguration.current.apiBaseURL.absoluteString)
            settingRow("내비 제공자", AppConfiguration.current.navigationProvider)
        }
        .padding(14)
        .festivalCard()
    }

    private var dataSourceCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("데이터 출처")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            Text("Kakao Local, 서울 열린데이터광장, data.go.kr provider를 백엔드에서 통합합니다.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.navy)
            Text("실시간 정보는 제공처 갱신 지연과 현장 상황에 따라 다를 수 있습니다.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.secondaryText)
        }
        .padding(14)
        .festivalCard()
    }

    private var providerStatusCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Provider 상태")
                    .font(.headline)
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
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(FestivalDesign.navy)
                        Spacer()
                        StatusBadge(text: provider.status, kind: provider.status == "up" ? .realtime : .warning)
                    }
                    Text("품질 점수 \(provider.qualityScore, specifier: "%.2f")")
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                    if let error = provider.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(FestivalDesign.coral)
                    }
                }
                .padding(10)
                .background(FestivalDesign.cream.opacity(0.35))
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.coral)
            }
        }
        .padding(14)
        .festivalCard()
    }

    private func settingRow(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(FestivalDesign.secondaryText)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(FestivalDesign.navy)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(FestivalDesign.cream.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
    }

    private func load() async {
        do {
            providers = try await apiClient.providerHealth()
        } catch {
            errorMessage = "provider 상태를 불러오지 못했습니다."
        }
    }
}
