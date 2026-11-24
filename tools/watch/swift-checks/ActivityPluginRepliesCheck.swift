// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct ActivityPluginRepliesCheck {
    static func main() {
        guard ActivityPluginReplies.configJson(["json": "{}"]) == "{}" else {
            fail("configJson accepts json")
        }
        guard ActivityPluginReplies.configJson(["json": "{}", "other": true]) == "{}" else {
            fail("configJson accepts json beside another option")
        }
        guard ActivityPluginReplies.configJson(nil) == nil else {
            fail("configJson rejects nil options")
        }
        guard ActivityPluginReplies.configJson([:]) == nil else {
            fail("configJson rejects empty options")
        }
        guard ActivityPluginReplies.configJson(["json": ""]) == nil else {
            fail("configJson rejects empty json")
        }
        guard ActivityPluginReplies.configJson(["json": 1]) == nil else {
            fail("configJson rejects numeric json")
        }
        guard ActivityPluginReplies.configJson(["other": "{}"]) == nil else {
            fail("configJson rejects missing json")
        }

        let runs: [Int64] = [1_700_000_000_000, 1_700_000_060_000, 1_700_000_120_000]
        let runLog = ActivityPluginReplies.runLog(runs)
        guard runLog.count == 1, runLog.keys.first == "times" else {
            fail("runLog has only the times key")
        }
        guard let times = runLog["times"] as? [Int64], times == runs else {
            fail("runLog preserves run order")
        }

        let emptyRunLog = ActivityPluginReplies.runLog([])
        guard
            emptyRunLog.count == 1,
            emptyRunLog.keys.first == "times",
            let emptyTimes = emptyRunLog["times"] as? [Int64],
            emptyTimes.isEmpty
        else {
            fail("runLog returns an empty times array")
        }

        checkCleared(true)
        checkCleared(false)

        let readerPath = "packages/core/src/shared/components/settings/WatchAlertsRows.jsx"
        guard
            let reader = try? String(contentsOfFile: readerPath, encoding: .utf8),
            reader.contains("result?.times")
        else {
            fail("WatchAlertsRows reads result?.times")
        }
    }

    private static func checkCleared(_ expected: Bool) {
        let reply = ActivityPluginReplies.cleared(expected)
        guard reply.count == 1, reply.keys.first == "cleared" else {
            fail("cleared \(expected) has only the cleared key")
        }
        guard let cleared = reply["cleared"] as? Bool, cleared == expected else {
            fail("cleared \(expected) preserves its value")
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
