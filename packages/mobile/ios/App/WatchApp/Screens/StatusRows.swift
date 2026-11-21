import Foundation

enum StatusRows {
    static let titleKey = "state.status"

    enum Value: Equatable {
        case flag(Bool)
        case age(balancesAt: Int64)
        case none
        case session(locked: Bool)
        case sessionUnknown
        case toggle(Bool)
        case text(String)
    }

    struct Row: Equatable {
        let labelKey: String
        let value: Value
    }

    static func rows(
        reachable: Bool,
        balancesAt: Int64?,
        session: String?,
        hideAmounts: Bool,
        appVersion: String
    ) -> [Row] {
        let lastSync: Value = balancesAt.map { .age(balancesAt: $0) } ?? .none
        let sessionValue: Value

        if reachable, session == "unlocked" {
            sessionValue = .session(locked: false)
        } else if reachable, session == "locked" {
            sessionValue = .session(locked: true)
        } else {
            sessionValue = .sessionUnknown
        }

        return [
            Row(labelKey: "state.phoneReachable", value: .flag(reachable)),
            Row(labelKey: "state.lastSync", value: lastSync),
            Row(labelKey: "state.session", value: sessionValue),
            Row(labelKey: "state.hideAmounts", value: .toggle(hideAmounts)),
            Row(labelKey: "state.version", value: .text(appVersion)),
        ]
    }

    static func valueKey(_ value: Value) -> String? {
        if value == .sessionUnknown {
            return "state.sessionUnknown"
        }
        return nil
    }
}
