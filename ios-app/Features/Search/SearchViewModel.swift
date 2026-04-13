import Foundation
import Combine
import UIKit

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query = ""
    @Published var destinations: [Destination] = []
    @Published var clipboardSuggestion: String?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: APIClientProtocol

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
    }

    func onAppear(appGroupID: String) {
        if let draft = SharedDestinationStore.consume(appGroupID: appGroupID) {
            query = draft.text
            clipboardSuggestion = draft.text
        } else if let text = UIPasteboard.general.string, looksLikeDestination(text) {
            clipboardSuggestion = text
        }
    }

    func useClipboardSuggestion() {
        guard let clipboardSuggestion else { return }
        query = clipboardSuggestion
        Task { await search() }
    }

    func search() async {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        isLoading = true
        errorMessage = nil
        do {
            destinations = try await apiClient.searchDestination(query: query)
        } catch {
            errorMessage = "목적지 검색에 실패했습니다. 네트워크 상태를 확인해 주세요."
        }
        isLoading = false
    }

    private func looksLikeDestination(_ text: String) -> Bool {
        text.count >= 3 && (text.contains("서울") || text.contains("로") || text.contains("길") || text.contains("역"))
    }
}
