// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum ViewActivity {
    static let activityType = "io.xchain.wallet.view"
    static let routeKey = "route"

    static func userInfo(for intent: OpenOnPhoneIntent) -> [String: String]? {
        guard !intent.route.isEmpty else {
            return nil
        }

        return [routeKey: intent.route]
    }
}
