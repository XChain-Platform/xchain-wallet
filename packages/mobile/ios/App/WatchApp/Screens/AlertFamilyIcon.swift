import Foundation

enum AlertFamilyIcon {
    static let phoneIcons: [String: String] = [
        "txConfirmations": "SendIcon",
        "incomingReceipts": "DownloadIcon",
        "incomingPending": "ClockIcon",
        "messages": "MessageIcon",
        "governancePolls": "ListIcon",
        "deadlines": "BellIcon",
        "dispenserEscrow": "CoinsIcon",
        "dispenserFills": "TokenIcon",
        "orderFills": "LineChartIcon",
        "priceAlerts": "BellIcon",
        "request": "DocumentIcon",
        "paydue": "ClockIcon",
    ]

    static let symbols: [String: String] = [
        "SendIcon": "paperplane",
        "DownloadIcon": "arrow.down.circle",
        "ClockIcon": "clock",
        "MessageIcon": "message",
        "ListIcon": "list.bullet",
        "BellIcon": "bell",
        "CoinsIcon": "dollarsign.circle",
        "TokenIcon": "circle.circle",
        "LineChartIcon": "chart.xyaxis.line",
        "DocumentIcon": "doc.text",
    ]

    static let fallbackSymbol = "bell"

    static func symbol(family: String) -> String {
        guard let phoneIcon = phoneIcons[family] else {
            return fallbackSymbol
        }

        return symbols[phoneIcon] ?? fallbackSymbol
    }
}
