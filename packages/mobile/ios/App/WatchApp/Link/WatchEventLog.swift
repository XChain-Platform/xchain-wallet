import Foundation
import os

enum WatchEventLog {
    static let subsystem = "io.xchain.wallet.ios.watch"
    static let category = "link"

    private static let logger = Logger(subsystem: subsystem, category: category)

    static func snapshotLine(v: Int) -> String {
        "snapshot received v\(v)"
    }

    static func screenLine(_ screen: WatchScreen) -> String {
        let screenID: String

        switch screen {
        case .balances:
            screenID = "W1"
        case .tokenDetail:
            screenID = "W2"
        case .alerts:
            screenID = "W3"
        case .alertDetail:
            screenID = "W4"
        case .receive:
            screenID = "W6"
        case .status:
            screenID = "W8"
        case .notSetUp:
            screenID = "W9"
        }

        return "screen shown \(screenID)"
    }

    static func snapshotReceived(v: Int) {
        logger.notice("\(snapshotLine(v: v), privacy: .public)")
    }

    static func snapshotRejected(reason: String) {
        logger.notice("snapshot rejected: \(reason, privacy: .public)")
    }

    static func screenShown(_ screen: WatchScreen) {
        logger.notice("\(screenLine(screen), privacy: .public)")
    }
}
