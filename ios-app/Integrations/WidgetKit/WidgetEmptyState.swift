import SwiftUI

/// 결과가 없는 이유를 상태별로 구분한다. 데이터가 없다고 늘 "필터를 조정해보세요"라고
/// 말하면, 아직 동기화를 못 했거나 위치를 모르는 경우에 잘못된 안내가 된다.
struct WidgetEmptyState: View {
    let entry: UpcomingFestivalsEntry
    var compact: Bool = false

    var body: some View {
        VStack(spacing: compact ? 4 : 6) {
            Image(systemName: symbolName)
                .font(.system(size: compact ? 18 : 22))
                .foregroundStyle(FestivalDesign.coralText)
            Text(title)
                .font(.system(size: compact ? 12 : 13, weight: .bold))
                .foregroundStyle(FestivalDesign.navy)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: compact ? 10 : 11))
                .foregroundStyle(FestivalDesign.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var symbolName: String {
        switch state {
        case .noCache: return "arrow.clockwise"
        case .noLocation: return "location.slash"
        case .filtered, .empty: return "calendar.badge.exclamationmark"
        }
    }

    private var title: String {
        switch state {
        case .noCache: return "아직 축제를 받아오지 못했어요"
        case .noLocation: return "위치를 확인하지 못했어요"
        case .filtered: return "조건에 맞는 축제가 없어요"
        case .empty: return "다가오는 축제가 없어요"
        }
    }

    private var message: String {
        switch state {
        case .noCache: return "앱을 한 번 열어 주세요"
        case .noLocation: return "앱에서 위치 권한을 확인해 주세요"
        case .filtered: return "앱에서 기간·지역 필터를 조정해보세요"
        case .empty: return "새 축제가 등록되면 여기에 표시돼요"
        }
    }

    private enum State {
        case noCache
        case noLocation
        case filtered
        case empty
    }

    private var state: State {
        if entry.generatedAt == nil { return .noCache }
        if entry.basisKind == .nationwide { return .noLocation }
        if entry.hasActiveFilter { return .filtered }
        return .empty
    }
}
