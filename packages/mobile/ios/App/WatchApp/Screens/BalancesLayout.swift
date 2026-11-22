// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum BalancesLayout {
    static let rowLimit = 50

    enum Item: Equatable {
        case request
        case row(Int)
        case moreOnPhone
        case empty
    }

    static func items(rowCount: Int, hasRequest: Bool, capped: Bool) -> [Item] {
        var items: [Item] = []

        if hasRequest {
            items.append(.request)
        }

        let listedRowCount = min(max(rowCount, 0), rowLimit)
        if listedRowCount == 0 {
            items.append(.empty)
            return items
        }

        items.append(contentsOf: (0..<listedRowCount).map(Item.row))
        if capped {
            items.append(.moreOnPhone)
        }

        return items
    }

    static func textKey(_ item: Item) -> String? {
        switch item {
        case .request:
            return "w1.requestWaiting"
        case .moreOnPhone:
            return "state.moreOnPhone"
        case .empty:
            return "w1.empty"
        case .row:
            return nil
        }
    }

    static func headerKey(fiatMode: Bool) -> String? {
        fiatMode ? nil : "w1.title"
    }

    static func amountCell(
        fiatMode: Bool,
        amountText: String,
        fiatText: String,
        noPrice: Bool
    ) -> (primary: String, secondary: String?) {
        guard fiatMode else {
            return (primary: amountText, secondary: nil)
        }

        return (
            primary: fiatText,
            secondary: noPrice ? amountText : nil
        )
    }
}
