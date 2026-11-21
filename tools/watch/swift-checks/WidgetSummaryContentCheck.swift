import Foundation

@main
struct WidgetSummaryContentCheck {
    static func main() {
        let cases: [(name: String, content: WidgetSummaryContent, expectedTotal: String?, expectedUnread: Int, expectedRequest: Bool, expectedBalancesAt: Int64?)] = [
            (
                "total kept when shown, unlocked and not hidden",
                make(showTotal: true, session: "unlocked", hidden: false, totalText: "$12.34", unreadCount: 3, requestWaiting: true, balancesAt: 1_700_000_000),
                "$12.34",
                3,
                true,
                1_700_000_000
            ),
            (
                "total dropped when Show total is off",
                make(showTotal: false, session: "unlocked", hidden: false, totalText: "$12.34", unreadCount: 4, requestWaiting: false, balancesAt: 1_700_000_001),
                nil,
                4,
                false,
                1_700_000_001
            ),
            (
                "total dropped when locked",
                make(showTotal: true, session: "locked", hidden: false, totalText: "$12.34", unreadCount: 5, requestWaiting: true, balancesAt: 1_700_000_002),
                nil,
                5,
                true,
                1_700_000_002
            ),
            (
                "total dropped when hidden",
                make(showTotal: true, session: "unlocked", hidden: true, totalText: "$12.34", unreadCount: 6, requestWaiting: false, balancesAt: 1_700_000_003),
                nil,
                6,
                false,
                1_700_000_003
            ),
            (
                "total dropped when empty",
                make(showTotal: true, session: "unlocked", hidden: false, totalText: "", unreadCount: 7, requestWaiting: true, balancesAt: nil),
                nil,
                7,
                true,
                nil
            ),
            (
                "negative unread count clamped",
                make(showTotal: true, session: "unlocked", hidden: false, totalText: "$12.34", unreadCount: -1, requestWaiting: false, balancesAt: 1_700_000_004),
                "$12.34",
                0,
                false,
                1_700_000_004
            )
        ]

        for testCase in cases {
            guard testCase.content.totalText == testCase.expectedTotal,
                  testCase.content.unreadCount == testCase.expectedUnread,
                  testCase.content.requestWaiting == testCase.expectedRequest,
                  testCase.content.balancesAt == testCase.expectedBalancesAt else {
                fail(testCase.name)
            }
        }

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        for testCase in cases {
            do {
                let data = try encoder.encode(testCase.content)
                let decoded = try decoder.decode(WidgetSummaryContent.self, from: data)
                guard decoded == testCase.content else {
                    fail("JSON round trip for \(testCase.name)")
                }

                if testCase.expectedTotal == nil {
                    let object = try JSONSerialization.jsonObject(with: data)
                    guard let dictionary = object as? [String: Any], dictionary["totalText"] == nil else {
                        fail("absent total encoded as no key for \(testCase.name)")
                    }
                }
            } catch {
                fail("JSON coding for \(testCase.name): \(error)")
            }
        }
    }

    private static func make(
        showTotal: Bool,
        session: String,
        hidden: Bool,
        totalText: String?,
        unreadCount: Int,
        requestWaiting: Bool,
        balancesAt: Int64?
    ) -> WidgetSummaryContent {
        WidgetSummaryContent.make(
            showTotal: showTotal,
            session: session,
            hidden: hidden,
            totalText: totalText,
            unreadCount: unreadCount,
            requestWaiting: requestWaiting,
            balancesAt: balancesAt
        )
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }
}
