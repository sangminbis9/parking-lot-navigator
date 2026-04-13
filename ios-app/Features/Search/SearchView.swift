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
        List {
            Section {
                HStack {
                    TextField("목적지, 주소, 장소명을 입력", text: $viewModel.query)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.search() } }
                    Button("검색") { Task { await viewModel.search() } }
                        .buttonStyle(.borderedProminent)
                }
            }

            if let suggestion = viewModel.clipboardSuggestion {
                Section("클립보드 제안") {
                    Button {
                        viewModel.useClipboardSuggestion()
                    } label: {
                        Label(suggestion, systemImage: "doc.on.clipboard")
                    }
                }
            }

            if viewModel.isLoading {
                Section { LoadingStateView(text: "목적지를 찾는 중입니다").frame(height: 120) }
            }

            if let errorMessage = viewModel.errorMessage {
                Section { FailureStateView(message: errorMessage) { Task { await viewModel.search() } } }
            }

            Section("검색 결과") {
                ForEach(viewModel.destinations) { destination in
                    Button {
                        destinationStore.addRecent(destination)
                        router.showResults(for: destination)
                    } label: {
                        DestinationRow(destination: destination)
                    }
                }
            }

            if !destinationStore.recents.isEmpty {
                Section("최근 목적지") {
                    ForEach(destinationStore.recents.prefix(5)) { destination in
                        Button {
                            router.showResults(for: destination)
                        } label: {
                            DestinationRow(destination: destination)
                        }
                    }
                }
            }
        }
        .navigationTitle("주차 목적지")
        .onAppear {
            viewModel.onAppear(appGroupID: AppConfiguration.current.appGroupID)
        }
    }
}

struct DestinationRow: View {
    let destination: Destination

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(destination.name).font(.headline)
            Text(destination.address).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}
