import SwiftUI

struct SearchView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var destinationStore: DestinationStore
    @StateObject private var viewModel: SearchViewModel

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: SearchViewModel(apiClient: apiClient))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SearchMascotHeader()
                searchCard

                if let suggestion = viewModel.clipboardSuggestion {
                    clipboardSuggestionCard(suggestion)
                }

                if viewModel.isLoading {
                    LoadingStateView(text: "목적지를 찾는 중입니다")
                        .frame(height: 120)
                        .padding()
                        .festivalCard()
                }

                if let errorMessage = viewModel.errorMessage {
                    FailureStateView(message: errorMessage) { Task { await viewModel.search() } }
                        .festivalCard()
                }

                destinationSection(title: "검색 결과", destinations: viewModel.destinations) { destination in
                    destinationStore.addRecent(destination)
                    router.showResults(for: destination)
                }

                if !destinationStore.recents.isEmpty {
                    destinationSection(title: "최근 목적지", destinations: Array(destinationStore.recents.prefix(5))) { destination in
                        router.showResults(for: destination)
                    }
                }
            }
            .padding(16)
        }
        .background(FestivalDesign.background.ignoresSafeArea())
        .navigationTitle("축제 목적지 검색")
        .onAppear {
            viewModel.onAppear(appGroupID: AppConfiguration.current.appGroupID)
        }
    }

    private var searchCard: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(FestivalDesign.teal)
            TextField("축제, 장소, 주소를 입력", text: $viewModel.query)
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit { Task { await viewModel.search() } }
            Button {
                Task { await viewModel.search() }
            } label: {
                Image(systemName: "arrow.right")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
            .tint(FestivalDesign.teal)
            .controlSize(.small)
        }
        .padding(12)
        .festivalCard()
    }

    private func clipboardSuggestionCard(_ suggestion: String) -> some View {
        Button {
            viewModel.useClipboardSuggestion()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "doc.on.clipboard")
                    .foregroundStyle(FestivalDesign.coral)
                Text(suggestion)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(FestivalDesign.navy)
                    .lineLimit(2)
                Spacer()
            }
            .padding(12)
            .festivalCard()
        }
        .buttonStyle(.plain)
    }

    private func destinationSection(
        title: String,
        destinations: [Destination],
        onSelect: @escaping (Destination) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(FestivalDesign.navy)

            if destinations.isEmpty {
                Text("표시할 목적지가 없습니다")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .festivalCard()
            } else {
                ForEach(destinations) { destination in
                    Button {
                        onSelect(destination)
                    } label: {
                        DestinationRow(destination: destination)
                            .padding(12)
                            .festivalCard()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct SearchMascotHeader: View {
    var body: some View {
        HStack(spacing: 12) {
            Image("FestivalMascotGuide")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("오늘 갈 축제를 찾아볼게요")
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text("장소를 고르면 근처 주차까지 이어서 안내합니다.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [FestivalDesign.cream.opacity(0.9), FestivalDesign.tealSoft],
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
}

struct DestinationRow: View {
    let destination: Destination

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill")
                .foregroundStyle(FestivalDesign.coral)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(destination.name)
                    .font(.headline)
                    .foregroundStyle(FestivalDesign.navy)
                Text(destination.address)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
        }
    }
}
