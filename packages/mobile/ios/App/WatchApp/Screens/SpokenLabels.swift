// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum SpokenLabels {
    static let separator = ", "
    static let hiddenKey = "state.amountHidden"
    static let unavailableKey = "state.balanceUnavailable"

    static func lines(_ parts: [String?]) -> String {
        parts.compactMap { part in
            guard let part,
                  !part.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }
            return part
        }.joined(separator: separator)
    }

    static func balanceRow(
        name: String,
        primary: String,
        secondary: String?,
        pendingText: String?,
        redacted: Bool,
        unavailable: Bool,
        hiddenText: String,
        unavailableText: String
    ) -> String {
        if unavailable {
            return lines([name, unavailableText])
        }
        if redacted {
            return lines([name, hiddenText])
        }
        return lines([name, primary, secondary, pendingText])
    }
}
