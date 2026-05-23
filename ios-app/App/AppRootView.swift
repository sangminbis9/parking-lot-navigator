import SwiftUI
import UIKit

enum AppRoute: Hashable {
    case parkingResults(Destination, DiscoverPresentation?)
    case parkingDetail(Destination, ParkingLot)
    case navigation(Destination, ParkingLot)
}

enum AppTab: Hashable {
    case map
    case discover
    case agentOffice
    case favorites
    case settings

    var title: String {
        switch self {
        case .map: return "지도"
        case .discover: return "이벤트"
        case .favorites: return "즐겨찾기"
        case .agentOffice: return "사무실"
        case .settings: return "설정"
        }
    }

    var systemImage: String {
        switch self {
        case .map: return "map.fill"
        case .discover: return "sparkles"
        case .favorites: return "star.fill"
        case .agentOffice: return "building.2.fill"
        case .settings: return "gearshape.fill"
        }
    }

    static let visibleTabs: [AppTab] = [.map, .discover, .favorites, .agentOffice, .settings]
}

final class AppTabRouter: ObservableObject {
    @Published var selectedTab: AppTab = .map
    @Published var discoverFilterQuery: String?
}

struct AppRootView: View {
    let apiClient: APIClientProtocol
    @EnvironmentObject private var themeStore: FestivalThemeStore
    @StateObject private var router = Router()
    @StateObject private var tabRouter = AppTabRouter()

    init(apiClient: APIClientProtocol) {
        self.apiClient = apiClient
        Self.configureTabBarAppearance()
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            routedStack {
                switch tabRouter.selectedTab {
                case .map:
                    MapHomeView(apiClient: apiClient)
                case .discover:
                    SearchView(apiClient: apiClient)
                case .favorites:
                    FavoritesView()
                case .agentOffice:
                    AgentOfficeView(apiClient: apiClient)
                case .settings:
                    SettingsView(apiClient: apiClient)
                }
            }
            .animation(.easeInOut(duration: 0.16), value: tabRouter.selectedTab)
            .safeAreaInset(edge: .bottom) {
                Color.clear.frame(height: 78)
            }

            FestivalTabBar(selection: $tabRouter.selectedTab)
                .padding(.horizontal, 14)
                .padding(.bottom, 8)
        }
        .tint(FestivalDesign.coral)
        .environmentObject(tabRouter)
        .onAppear {
            Self.configureTabBarAppearance()
        }
        .onChange(of: themeStore.selectedTheme) { _ in
            Self.configureTabBarAppearance()
        }
        .onChange(of: tabRouter.selectedTab) { _ in
            router.path.removeAll()
        }
    }

    private func routedStack<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: $router.path) {
            content()
                .navigationDestination(for: AppRoute.self) { route in
                    routeDestination(for: route)
                }
        }
        .environmentObject(router)
    }

    @ViewBuilder
    private func routeDestination(for route: AppRoute) -> some View {
        switch route {
        case .parkingResults(let destination, let presentation):
            ParkingResultsView(destination: destination, apiClient: apiClient, presentation: presentation)
        case .parkingDetail(let destination, let parkingLot):
            ParkingDetailView(destination: destination, parkingLot: parkingLot)
        case .navigation(let destination, let parkingLot):
            NavigationLaunchView(destination: destination, parkingLot: parkingLot)
        }
    }

    private static func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(FestivalDesign.surface)
        appearance.shadowColor = UIColor(FestivalDesign.creamDeep.opacity(0.55))

        let selectedColor = UIColor(FestivalDesign.coral)
        let normalColor = UIColor(FestivalDesign.secondaryText)
        let selectedAttributes: [NSAttributedString.Key: Any] = [.foregroundColor: selectedColor]
        let normalAttributes: [NSAttributedString.Key: Any] = [.foregroundColor: normalColor]

        [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance].forEach { item in
            item.selected.iconColor = selectedColor
            item.selected.titleTextAttributes = selectedAttributes
            item.normal.iconColor = normalColor
            item.normal.titleTextAttributes = normalAttributes
        }

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
        configureNavigationBarAppearance()
    }

    private static func configureNavigationBarAppearance() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(FestivalDesign.surface)
        appearance.shadowColor = UIColor(FestivalDesign.creamDeep.opacity(0.55))

        let titleColor = UIColor(FestivalDesign.coral)
        appearance.titleTextAttributes = [
            .foregroundColor: titleColor,
            .font: UIFont.systemFont(ofSize: 17, weight: .bold)
        ]
        appearance.largeTitleTextAttributes = [
            .foregroundColor: titleColor,
            .font: UIFont.systemFont(ofSize: 34, weight: .bold)
        ]

        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().tintColor = titleColor
    }
}

private struct FestivalTabBar: View {
    @Binding var selection: AppTab

    var body: some View {
        HStack(spacing: 6) {
            ForEach(AppTab.visibleTabs, id: \.self) { tab in
                tabButton(tab)
            }
        }
        .padding(6)
        .background(
            LinearGradient(
                colors: [FestivalDesign.surface.opacity(0.98), FestivalDesign.cream.opacity(0.92)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(FestivalDesign.creamDeep.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: FestivalDesign.navy.opacity(0.14), radius: 14, y: 7)
    }

    private func tabButton(_ tab: AppTab) -> some View {
        let isSelected = selection == tab

        return Button {
            selection = tab
        } label: {
            VStack(spacing: 4) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isSelected ? FestivalDesign.tealSoft : Color.clear)
                        .frame(width: 42, height: 30)
                    Image(systemName: tab.systemImage)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(isSelected ? FestivalDesign.coral : FestivalDesign.secondaryText)
                }
                Text(tab.title)
                    .font(.system(size: 10, weight: isSelected ? .bold : .semibold))
                    .foregroundStyle(isSelected ? FestivalDesign.navy : FestivalDesign.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(isSelected ? FestivalDesign.cream.opacity(0.55) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
    }
}

final class Router: ObservableObject {
    @Published var path: [AppRoute] = []

    func showResults(for destination: Destination, presentation: DiscoverPresentation? = nil) {
        path.append(.parkingResults(destination, presentation))
    }

    func showDetail(destination: Destination, parkingLot: ParkingLot) {
        path.append(.parkingDetail(destination, parkingLot))
    }

    func startNavigation(destination: Destination, parkingLot: ParkingLot) {
        path.append(.navigation(destination, parkingLot))
    }
}
