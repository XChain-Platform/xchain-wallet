import Foundation

@main
struct WatchScreenGraphCheck {
    static func main() {
        checkRoot()
        checkNotSetUpTextKey()
        checkPushes()
        checkNotificationPaths()
    }

    private static func checkRoot() {
        expect(
            WatchScreenGraph.root(hasSnapshot: false, enabled: false) == .notSetUp,
            "root without snapshot when disabled"
        )
        expect(
            WatchScreenGraph.root(hasSnapshot: false, enabled: true) == .notSetUp,
            "root without snapshot when enabled"
        )
        expect(
            WatchScreenGraph.root(hasSnapshot: true, enabled: false) == .notSetUp,
            "root with disabled snapshot"
        )
        expect(
            WatchScreenGraph.root(hasSnapshot: true, enabled: true) == .balances,
            "root with enabled snapshot"
        )
    }

    private static func checkNotSetUpTextKey() {
        expect(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: false, enabled: false)
                == "state.openWalletOnPhone",
            "text key without snapshot when disabled"
        )
        expect(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: false, enabled: true)
                == "state.openWalletOnPhone",
            "text key without snapshot when enabled"
        )
        expect(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: true, enabled: false)
                == "state.watchDisabled",
            "text key with disabled snapshot"
        )
        expect(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: true, enabled: true) == nil,
            "text key with enabled snapshot"
        )
    }

    private static func checkPushes() {
        let expected = [
            [false, true, true, true, true, true, false],
            [false, false, false, false, false, false, false],
            [false, false, false, true, false, false, false],
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false],
        ]

        expect(WatchScreen.allCases.count == expected.count, "screen count")

        for (fromIndex, from) in WatchScreen.allCases.enumerated() {
            for (toIndex, to) in WatchScreen.allCases.enumerated() {
                expect(
                    WatchScreenGraph.canPush(to, from: from) == expected[fromIndex][toIndex],
                    "push from \(from.rawValue) to \(to.rawValue)"
                )
            }
        }
    }

    private static func checkNotificationPaths() {
        expect(
            WatchScreenGraph.notificationPath(category: "request") == [.balances, .alertDetail],
            "request notification path"
        )
        expect(
            WatchScreenGraph.notificationPath(category: "paydue") == [.balances, .alertDetail],
            "paydue notification path"
        )
        expect(
            WatchScreenGraph.notificationPath(category: "alert") == [.balances],
            "alert notification path"
        )
        expect(
            WatchScreenGraph.notificationPath(category: "") == [.balances],
            "empty notification path"
        )
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
    }
}
