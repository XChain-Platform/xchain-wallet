// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct NotifyScheduleArgs: Equatable {
    let post: NotifyPostArgs
    let atMs: Int64

    static func parse(_ values: [String: Any]) -> NotifyScheduleArgs? {
        guard
            let post = NotifyPostArgs.parse(values),
            let at = values["at"] as? NSNumber,
            CFGetTypeID(at) != CFBooleanGetTypeID()
        else {
            return nil
        }

        let milliseconds = at.doubleValue
        guard
            milliseconds.isFinite,
            milliseconds > 0,
            milliseconds <= 9_007_199_254_740_991
        else {
            return nil
        }

        return NotifyScheduleArgs(post: post, atMs: Int64(milliseconds.rounded(.down)))
    }

    static func cancelId(_ values: [String: Any]) -> String? {
        guard let id = values["id"] as? String, !id.isEmpty else {
            return nil
        }
        return id
    }
}
