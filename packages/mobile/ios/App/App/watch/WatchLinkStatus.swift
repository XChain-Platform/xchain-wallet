// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum WatchLinkStatus {
    static func dictionary(
        supported: Bool,
        activated: Bool,
        paired: Bool,
        installed: Bool,
        reachable: Bool,
        lastSyncAt: Int64?
    ) -> [String: Any] {
        let paired = supported && activated && paired
        let installed = paired && installed
        let reachable = installed && reachable

        var status: [String: Any] = [
            "paired": paired,
            "installed": installed,
            "reachable": reachable,
        ]

        if let lastSyncAt, lastSyncAt >= 0 {
            status["lastSyncAt"] = lastSyncAt
        }

        return status
    }
}
