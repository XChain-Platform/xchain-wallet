// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum ReceivePages {
    static let emptyKey = "w6.empty"

    static func pages(_ receive: [SnapshotReceive]?) -> [SnapshotReceive] {
        guard let receive else { return [] }

        var chainIds = Set<String>()
        return receive.filter { entry in
            guard !entry.chainId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !entry.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  chainIds.insert(entry.chainId).inserted else {
                return false
            }
            return true
        }
    }

    static func noticeKey(_ pages: [SnapshotReceive]) -> String? {
        pages.isEmpty ? emptyKey : nil
    }

    static func clampedPage(_ index: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return min(max(index, 0), count - 1)
    }
}
