// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum AccessibilityLabels {
    static func balanceLines(
        _ display: BalancesDisplay,
        text: (String) -> String
    ) -> [String] {
        display.lines.map { line in
            if let key = line.key {
                return text(key)
            }

            return SpokenLabels.lines([
                line.name,
                spoken(line.primary, isPrimary: true, text: text),
                spoken(line.secondary, isPrimary: false, text: text),
            ])
        }
    }

    private static func spoken(
        _ value: BalanceText?,
        isPrimary: Bool,
        text: (String) -> String
    ) -> String? {
        guard let value else {
            return nil
        }
        if isPrimary, value.key == "state.hidden" {
            return text(SpokenLabels.hiddenKey)
        }
        if let valueText = value.text {
            return valueText
        }
        return value.key.map(text)
    }
}
