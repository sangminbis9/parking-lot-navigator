import SwiftUI

struct SettingsView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var themeStore: FestivalThemeStore
    @State private var providers: [ProviderHealth] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    settingsHeader
                    themePickerCard
                    merchantCard
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

    private var merchantURL: URL {
        AppConfiguration.current.apiBaseURL.appendingPathComponent("merchant")
    }

    private var themePickerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("앱 테마")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("메인 파스텔 톤을 고르면 전체 카드, 배경, 강조색 조합이 함께 바뀝니다.")
                    .font(.subheadline)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 142), spacing: 10)], spacing: 10) {
                ForEach(FestivalTheme.allCases) { theme in
                    themeButton(for: theme)
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "textformat.size")
                    .foregroundStyle(FestivalDesign.coral)
                Text("모든 테마는 파스텔 바탕 위에 흰 글씨를 쓰지 않도록 어두운 본문색을 기준으로 구성했습니다.")
                    .font(.caption)
                    .foregroundStyle(FestivalDesign.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .background(FestivalDesign.cream.opacity(0.35))
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
        }
        .padding(14)
        .festivalCard()
    }

    private func themeButton(for theme: FestivalTheme) -> some View {
        let isSelected = themeStore.selectedTheme == theme
        let palette = theme.palette

        return Button {
            themeStore.select(theme)
        } label: {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: -4) {
                    themeSwatch(palette.cream)
                    themeSwatch(palette.coral)
                    themeSwatch(palette.teal)
                    themeSwatch(palette.parkingBlue)
                    Spacer(minLength: 0)
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(FestivalDesign.coral)
                    }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(theme.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(FestivalDesign.navy)
                    Text(theme.description)
                        .font(.caption)
                        .foregroundStyle(FestivalDesign.secondaryText)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(11)
            .background(isSelected ? palette.tealSoft.opacity(0.9) : palette.cream.opacity(0.28))
            .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            .overlay(
                RoundedRectangle(cornerRadius: FestivalDesign.controlRadius)
                    .stroke(isSelected ? FestivalDesign.coral : palette.creamDeep.opacity(0.5), lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(theme.displayName) 테마")
    }

    private func themeSwatch(_ color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 20, height: 20)
            .overlay(Circle().stroke(FestivalDesign.surface, lineWidth: 2))
    }

    private var merchantCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("내 가게 운영")
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)
            Text("내 가게의 할인, 무료 제공, 팝업, 오픈 이벤트를 앱 지도에 노출해보세요. 등록과 결제는 외부 웹페이지에서 진행됩니다.")
                .font(.subheadline)
                .foregroundStyle(FestivalDesign.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            Link(destination: merchantURL) {
                HStack(spacing: 8) {
                    Image(systemName: "building.2.fill")
                    Text("내 가게 이벤트 등록")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .font(.subheadline)
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 12)
                .background(FestivalDesign.navy)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: FestivalDesign.controlRadius))
            }
        }
        .padding(14)
        .festivalCard()
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
