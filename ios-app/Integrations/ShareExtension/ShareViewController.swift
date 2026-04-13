import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handleSharedItems() }
    }

    private func handleSharedItems() async {
        let text = await extractSharedText() ?? ""
        let cleaned = DestinationTextParser.clean(text)
        if !cleaned.isEmpty {
            SharedDestinationStore.save(
                SharedDestinationDraft(text: cleaned, receivedAt: Date()),
                appGroupID: appGroupID
            )
            openMainApp(query: cleaned)
        }
        extensionContext?.completeRequest(returningItems: nil)
    }

    private var appGroupID: String {
        Bundle.main.object(forInfoDictionaryKey: "APP_GROUP_ID") as? String ?? "group.com.example.ParkingLotNavigator"
    }

    private func extractSharedText() async -> String? {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let providers = item.attachments else { return nil }

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) {
                return (value as? URL)?.absoluteString
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) {
                return value as? String
            }
        }
        return nil
    }

    private func openMainApp(query: String) {
        var components = URLComponents()
        components.scheme = "parkingnavigator"
        components.host = "search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components.url else { return }
        extensionContext?.open(url)
    }
}

enum DestinationTextParser {
    static func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
