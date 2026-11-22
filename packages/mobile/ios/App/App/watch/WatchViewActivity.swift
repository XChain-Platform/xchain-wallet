// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum WatchViewActivity {
    static let activityType = "io.xchain.wallet.view"
    static let routeKey = "route"

    static func route(
        activityType: String,
        userInfo: [AnyHashable: Any]?
    ) -> String? {
        guard activityType == Self.activityType,
              let userInfo,
              userInfo.count == 1,
              let route = userInfo[routeKey] as? String,
              !route.isEmpty else {
            return nil
        }

        return route
    }
}
