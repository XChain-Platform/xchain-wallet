import Foundation

struct WidgetSummaryContent: Codable, Equatable {
    let unreadCount: Int
    let requestWaiting: Bool
    let totalText: String?
    let balancesAt: Int64?

    static func make(
        showTotal: Bool,
        session: String,
        hidden: Bool,
        totalText: String?,
        unreadCount: Int,
        requestWaiting: Bool,
        balancesAt: Int64?
    ) -> WidgetSummaryContent {
        let visibleTotal = showTotal && session == "unlocked" && !hidden && totalText?.isEmpty == false

        return WidgetSummaryContent(
            unreadCount: max(0, unreadCount),
            requestWaiting: requestWaiting,
            totalText: visibleTotal ? totalText : nil,
            balancesAt: balancesAt
        )
    }
}
