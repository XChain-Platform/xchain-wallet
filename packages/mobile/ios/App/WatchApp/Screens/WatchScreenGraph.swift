import Foundation

enum WatchScreen: String, CaseIterable {
    case balances
    case tokenDetail
    case alerts
    case alertDetail
    case receive
    case status
    case notSetUp
}

enum WatchScreenGraph {
    static func root(hasSnapshot: Bool, enabled: Bool) -> WatchScreen {
        guard hasSnapshot, enabled else {
            return .notSetUp
        }

        return .balances
    }

    static func notSetUpTextKey(hasSnapshot: Bool, enabled: Bool) -> String? {
        guard hasSnapshot else {
            return "state.openWalletOnPhone"
        }

        guard enabled else {
            return "state.watchDisabled"
        }

        return nil
    }

    static func canPush(_ to: WatchScreen, from: WatchScreen) -> Bool {
        switch (from, to) {
        case (.balances, .tokenDetail),
             (.balances, .alerts),
             (.balances, .alertDetail),
             (.balances, .receive),
             (.balances, .status),
             (.alerts, .alertDetail):
            return true
        default:
            return false
        }
    }

    static func notificationPath(category: String) -> [WatchScreen] {
        switch category {
        case "request", "paydue":
            return [.balances, .alertDetail]
        default:
            return [.balances]
        }
    }
}
