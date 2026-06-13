import SwiftUI

enum FestivalPrimaryCategory: String, CaseIterable, Codable, Hashable {
    case musicPerformance = "music_performance"
    case foodDrink = "food_drink"
    case natureFlower = "nature_flower"
    case lightNight = "light_night"
    case traditionCulture = "tradition_culture"
    case familyKids = "family_kids"
    case marketFlea = "market_flea"
    case sportsOutdoor = "sports_outdoor"
    case filmMedia = "film_media"
    case artExhibition = "art_exhibition"
    case etc

    var displayName: String {
        switch self {
        case .musicPerformance: return "음악·공연"
        case .foodDrink: return "먹거리"
        case .natureFlower: return "자연·꽃"
        case .lightNight: return "불꽃·야경"
        case .traditionCulture: return "전통·문화"
        case .familyKids: return "가족·키즈"
        case .marketFlea: return "마켓·플리마켓"
        case .sportsOutdoor: return "스포츠·아웃도어"
        case .filmMedia: return "영화·미디어"
        case .artExhibition: return "예술·전시"
        case .etc: return "기타"
        }
    }

    var systemImage: String {
        switch self {
        case .musicPerformance: return "music.note"
        case .foodDrink: return "fork.knife"
        case .natureFlower: return "leaf.fill"
        case .lightNight: return "sparkles"
        case .traditionCulture: return "building.columns"
        case .familyKids: return "figure.2.and.child.holdinghands"
        case .marketFlea: return "bag.fill"
        case .sportsOutdoor: return "figure.run"
        case .filmMedia: return "film.fill"
        case .artExhibition: return "paintpalette.fill"
        case .etc: return "star.circle"
        }
    }

    var tint: Color {
        switch self {
        case .musicPerformance: return Color(red: 0.902, green: 0.224, blue: 0.275) // #E63946
        case .foodDrink: return Color(red: 0.957, green: 0.635, blue: 0.380)         // #F4A261
        case .natureFlower: return Color(red: 0.165, green: 0.616, blue: 0.561)      // #2A9D8F
        case .lightNight: return Color(red: 0.416, green: 0.298, blue: 0.576)        // #6A4C93
        case .traditionCulture: return Color(red: 0.690, green: 0.490, blue: 0.384)  // #B07D62
        case .familyKids: return Color(red: 0.949, green: 0.518, blue: 0.510)        // #F28482
        case .marketFlea: return Color(red: 0.553, green: 0.600, blue: 0.682)        // #8D99AE
        case .sportsOutdoor: return Color(red: 0.169, green: 0.576, blue: 0.282)     // #2B9348
        case .filmMedia: return Color(red: 0.149, green: 0.388, blue: 0.408)         // #264653
        case .artExhibition: return Color(red: 0.616, green: 0.306, blue: 0.867)     // #9D4EDD
        case .etc: return Color(red: 0.424, green: 0.459, blue: 0.490)               // #6C757D
        }
    }

    var emoji: String {
        switch self {
        case .musicPerformance:  return "🎵"
        case .foodDrink:         return "🍽️"
        case .natureFlower:      return "🌸"
        case .lightNight:        return "✨"
        case .traditionCulture:  return "🏛️"
        case .familyKids:        return "👨‍👩‍👧"
        case .marketFlea:        return "🛍️"
        case .sportsOutdoor:     return "🏃"
        case .filmMedia:         return "🎬"
        case .artExhibition:     return "🎨"
        case .etc:               return "🎪"
        }
    }
}

enum LocalEventPrimaryCategory: String, CaseIterable, Codable, Hashable {
    case discount
    case freebie
    case newLimited = "new_limited"
    case popup
    case opening
    case reviewEvent = "review_event"
    case seasonal
    case etc

    var displayName: String {
        switch self {
        case .discount: return "할인·세일"
        case .freebie: return "무료 증정"
        case .newLimited: return "신메뉴·한정"
        case .popup: return "팝업·이벤트"
        case .opening: return "오픈 이벤트"
        case .reviewEvent: return "리뷰 이벤트"
        case .seasonal: return "시즌·기념일"
        case .etc: return "기타"
        }
    }

    var systemImage: String {
        switch self {
        case .discount: return "tag.fill"
        case .freebie: return "gift.fill"
        case .newLimited: return "sparkles"
        case .popup: return "storefront.fill"
        case .opening: return "party.popper.fill"
        case .reviewEvent: return "star.bubble.fill"
        case .seasonal: return "calendar"
        case .etc: return "ellipsis.circle"
        }
    }

    var tint: Color {
        switch self {
        case .discount: return Color(red: 0.902, green: 0.224, blue: 0.275)   // #E63946
        case .freebie: return Color(red: 0.957, green: 0.635, blue: 0.380)    // #F4A261
        case .newLimited: return Color(red: 0.416, green: 0.298, blue: 0.576) // #6A4C93
        case .popup: return Color(red: 0.165, green: 0.616, blue: 0.561)      // #2A9D8F
        case .opening: return Color(red: 0.949, green: 0.518, blue: 0.510)    // #F28482
        case .reviewEvent: return Color(red: 1.000, green: 0.718, blue: 0.012) // #FFB703
        case .seasonal: return Color(red: 0.553, green: 0.600, blue: 0.682)   // #8D99AE
        case .etc: return Color(red: 0.424, green: 0.459, blue: 0.490)        // #6C757D
        }
    }
}

extension FestivalPrimaryCategory {
    var uiTint: UIColor { UIColor(tint) }
}

extension LocalEventPrimaryCategory {
    var uiTint: UIColor { UIColor(tint) }
}
