import Foundation

enum BalancesToolbarRules {
    enum Control {
        case bell
        case qr
        case status
    }

    static let controls: [Control] = [.bell, .qr, .status]

    static func destination(_ control: Control) -> WatchScreen {
        switch control {
        case .bell:
            return .alerts
        case .qr:
            return .receive
        case .status:
            return .status
        }
    }

    static func destination(_ item: BalancesLayout.Item) -> WatchScreen? {
        switch item {
        case .row:
            return .tokenDetail
        case .request:
            return .alertDetail
        case .moreOnPhone, .empty:
            return nil
        }
    }

    static func showsUnreadDot(unread: Int) -> Bool {
        unread > 0
    }

    static func headerTap(mode: WatchUnitsMode, isTest: Bool) -> WatchUnitsMode? {
        guard !isTest else {
            return nil
        }

        return mode.toggled(isTest: isTest)
    }

    static func doubleTapAvailable(osMajor: Int) -> Bool {
        osMajor >= 11
    }
}
