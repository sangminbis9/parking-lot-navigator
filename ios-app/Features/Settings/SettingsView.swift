import SwiftUI

struct SettingsView: View {
    let apiClient: APIClientProtocol
    @State private var providers: [ProviderHealth] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section("앱 설정") {
                    LabeledContent("API 서버", value: AppConfiguration.current.apiBaseURL.absoluteString)
                    LabeledContent("내비 제공자", value: AppConfiguration.current.navigationProvider)
                }

                Section("데이터 출처") {
                    Text("Kakao Local, 서울 열린데이터광장, data.go.kr provider를 백엔드에서 통합합니다.")
                    Text("실시간 정보는 제공처 갱신 지연과 현장 상황에 따라 다를 수 있습니다.")
                        .foregroundStyle(.secondary)
                }

                Section("Provider 상태") {
                    ForEach(providers) { provider in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(provider.name).font(.headline)
                                Spacer()
                                StatusBadge(text: provider.status, kind: provider.status == "up" ? .realtime : .warning)
                            }
                            Text("품질 점수 \(provider.qualityScore, specifier: "%.2f")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let error = provider.lastError {
                                Text(error).font(.caption).foregroundStyle(.red)
                            }
                        }
                    }
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("설정")
            .task { await load() }
        }
    }

    private func load() async {
        do {
            providers = try await apiClient.providerHealth()
        } catch {
            errorMessage = "provider 상태를 불러오지 못했습니다."
        }
    }
}
