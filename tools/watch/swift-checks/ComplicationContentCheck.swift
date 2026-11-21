import Foundation

@main
enum ComplicationContentCheck {
    private static func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("Failed: \(name)\n".utf8))
            exit(1)
        }
    }

    static func main() {
        expect(
            ComplicationContent.badge(requestWaiting: true, unreadCount: 0) == .request,
            "waiting request with 0 unread"
        )
        expect(
            ComplicationContent.badge(requestWaiting: true, unreadCount: 3) == .request,
            "waiting request with 3 unread"
        )
        expect(
            ComplicationContent.badge(requestWaiting: false, unreadCount: 3) == .unread(3),
            "3 unread with no waiting request"
        )
        expect(
            ComplicationContent.badge(requestWaiting: false, unreadCount: 0) == .none,
            "0 unread with no waiting request"
        )
        expect(
            ComplicationContent.badge(requestWaiting: false, unreadCount: -2) == .none,
            "negative unread with no waiting request"
        )
        expect(
            ComplicationContent.headline(totalText: "$1,234.56", unreadCount: 5) == .total("$1,234.56"),
            "total text with unread alerts"
        )
        expect(
            ComplicationContent.headline(totalText: nil, unreadCount: 5) == .alerts(5),
            "nil total with unread alerts"
        )
        expect(
            ComplicationContent.headline(totalText: "", unreadCount: 5) == .alerts(5),
            "empty total with unread alerts"
        )
        expect(
            ComplicationContent.headline(totalText: nil, unreadCount: -1) == .alerts(0),
            "negative unread with no total"
        )
    }
}
