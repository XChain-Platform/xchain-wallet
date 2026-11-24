// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum ActivityPluginReplies {
    static func configJson(_ options: [String: Any]?) -> String? {
        guard let json = options?["json"] as? String, !json.isEmpty else {
            return nil
        }

        return json
    }

    static func runLog(_ runs: [Int64]) -> [String: Any] {
        ["times": runs]
    }

    static func cleared(_ ok: Bool) -> [String: Any] {
        ["cleared": ok]
    }
}
