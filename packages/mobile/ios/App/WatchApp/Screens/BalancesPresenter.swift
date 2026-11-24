// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct BalanceText: Equatable {
    let key: String?
    let text: String?

    init(key: String? = nil, text: String? = nil) {
        self.key = key
        self.text = text
    }
}

struct BalanceLine: Equatable {
    let name: String?
    let primary: BalanceText?
    let secondary: BalanceText?
    let key: String?

    init(
        name: String? = nil,
        primary: BalanceText? = nil,
        secondary: BalanceText? = nil,
        key: String? = nil
    ) {
        self.name = name
        self.primary = primary
        self.secondary = secondary
        self.key = key
    }
}

enum BalancesAgeSeverity: String, Equatable {
    case normal
    case amber
}

struct BalancesDisplay: Equatable {
    let header: BalanceText?
    let lines: [BalanceLine]
    let banners: [String]
    let ageLine: String?
    let ageSeverity: BalancesAgeSeverity?
    let requestKey: String?
}

enum BalancesPresenter {
    static func present(
        snapshot: Snapshot?,
        mode: WatchUnitsMode? = nil,
        phoneReachable: Bool = true,
        now: Int64? = nil
    ) -> BalancesDisplay {
        guard let snapshot else {
            return empty(banner: "state.loading")
        }
        guard snapshot.settings.enabled else {
            return empty(banner: "state.watchDisabled")
        }

        let resolved = WatchUnitsMode.resolve(
            stored: mode,
            unitDefault: snapshot.unitDefault,
            isTest: snapshot.network.isTest
        )
        let fiatMode = resolved == .fiat
        let currentTime = now ?? snapshot.builtAt
        let banners = StateBannerRules.banners(
            hasSnapshot: true,
            session: snapshot.session,
            reachable: phoneReachable,
            balancesAt: snapshot.balancesAt,
            now: currentTime
        ).map(StateBannerRules.textKey)
        let ageState = StateBannerRules.ageLine(
            hasSnapshot: true,
            balancesAt: snapshot.balancesAt,
            now: currentTime
        )
        let lines = BalancesLayout.items(
            rowCount: snapshot.rows.count,
            hasRequest: false,
            capped: snapshot.capped
        ).map { item in
            switch item {
            case let .row(index):
                return line(snapshot.rows[index], fiatMode: fiatMode, hidden: snapshot.hidden)
            default:
                return BalanceLine(key: BalancesLayout.textKey(item))
            }
        }

        let header: BalanceText
        if snapshot.hidden && fiatMode {
            header = BalanceText(key: "state.hidden")
        } else if fiatMode {
            header = BalanceText(text: snapshot.totals.fiatText)
        } else {
            header = BalanceText(key: BalancesLayout.headerKey(fiatMode: false))
        }

        return BalancesDisplay(
            header: header,
            lines: lines,
            banners: banners,
            ageLine: ageState.map(StateBannerRules.textKey),
            ageSeverity: ageState.map { $0 == .ageAmber ? .amber : .normal },
            requestKey: "w1.requestWaiting"
        )
    }

    private static func line(
        _ row: SnapshotRow,
        fiatMode: Bool,
        hidden: Bool
    ) -> BalanceLine {
        if hidden {
            return BalanceLine(name: row.displayName, primary: BalanceText(key: "state.hidden"))
        }
        if row.unavailable {
            return BalanceLine(
                name: row.displayName,
                primary: BalanceText(key: "state.balanceUnavailable")
            )
        }

        let amount = BalancesLayout.amountCell(
            fiatMode: fiatMode,
            amountText: row.amountText,
            fiatText: row.fiatText,
            noPrice: row.noPrice
        )
        return BalanceLine(
            name: row.displayName,
            primary: BalanceText(text: amount.primary),
            secondary: amount.secondary.map { BalanceText(text: $0) }
        )
    }

    private static func empty(banner: String) -> BalancesDisplay {
        BalancesDisplay(
            header: nil,
            lines: [],
            banners: [banner],
            ageLine: nil,
            ageSeverity: nil,
            requestKey: nil
        )
    }
}
