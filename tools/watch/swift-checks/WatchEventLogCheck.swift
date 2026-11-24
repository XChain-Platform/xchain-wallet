import Foundation

@main
struct WatchEventLogCheck {
    static func main() {
        check(
            WatchEventLog.snapshotLine(v: 1) == "snapshot received v1",
            "snapshotLine(v: 1)"
        )
        check(
            WatchEventLog.snapshotLine(v: 2) == "snapshot received v2",
            "snapshotLine(v: 2)"
        )

        let expectedLines: [WatchScreen: String] = [
            .balances: "screen shown W1",
            .tokenDetail: "screen shown W2",
            .alerts: "screen shown W3",
            .alertDetail: "screen shown W4",
            .receive: "screen shown W6",
            .status: "screen shown W8",
            .notSetUp: "screen shown W9",
        ]

        for screen in WatchScreen.allCases {
            check(
                WatchEventLog.screenLine(screen) == expectedLines[screen],
                "screenLine(\(screen.rawValue))"
            )
        }

        let lines = WatchScreen.allCases.map(WatchEventLog.screenLine)
        check(Set(lines).count == 7, "seven distinct screen lines")
        check(
            WatchEventLog.subsystem == "io.xchain.wallet.ios.watch",
            "subsystem"
        )
        check(WatchEventLog.category == "link", "category")

        WatchEventLog.snapshotReceived(v: 1)
        WatchEventLog.screenShown(.balances)
    }

    private static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
            exit(1)
        }
    }
}
