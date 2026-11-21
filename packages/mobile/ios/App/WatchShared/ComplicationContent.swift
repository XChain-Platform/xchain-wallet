import Foundation

enum ComplicationContent {
    enum Badge: Equatable {
        case request
        case unread(Int)
        case none
    }

    static func badge(requestWaiting: Bool, unreadCount: Int) -> Badge {
        if requestWaiting {
            return .request
        }

        if unreadCount > 0 {
            return .unread(unreadCount)
        }

        return .none
    }

    enum Headline: Equatable {
        case total(String)
        case alerts(Int)
    }

    static func headline(totalText: String?, unreadCount: Int) -> Headline {
        if let totalText, !totalText.isEmpty {
            return .total(totalText)
        }

        return .alerts(max(0, unreadCount))
    }
}
