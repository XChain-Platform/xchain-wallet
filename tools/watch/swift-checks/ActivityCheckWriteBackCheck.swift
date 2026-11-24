// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct ActivityCheckWriteBackCheck {
    static func main() {
        let json = #"""
        {
          "enabled": true,
          "unknownTopLevel": {"kept": 7},
          "targets": [
            {
              "address": "A",
              "url": "https://explorer.example/address/A",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending",
              "lastCheckedAt": 1700000000000,
              "confirmed": "0.5",
              "pending": "0",
              "targetExtra": "kept"
            },
            {
              "address": "B",
              "url": "https://explorer.example/address/B",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending"
            },
            {
              "address": "A",
              "url": "https://duplicate.example/address/A",
              "confirmedPath": "balances.confirmed",
              "pendingPath": "balances.pending",
              "lastCheckedAt": 5,
              "confirmed": "duplicate",
              "pending": "duplicate"
            }
          ],
          "notice": {
            "title": "New activity",
            "body": "Your balances changed",
            "noticeExtra": true
          }
        }
        """#

        let config = require("producer shape decodes", ActivityCheckConfig.decode(json))
        check(
            "first timestamp and baseline win",
            ActivityCheckWriteBack.lastCheckedAt(json) == ["A": 1_700_000_000_000]
                && ActivityCheckWriteBack.baseline(config) == ["A": ["0.5", "0"]]
        )
        let duplicateWithoutBaseline = ActivityCheckConfig(
            enabled: true,
            targets: [
                target(address: "A", confirmed: nil, pending: nil),
                target(address: "A", confirmed: "later", pending: "later"),
            ],
            noticeTitle: nil,
            noticeBody: nil,
            openOnPhoneTitle: nil
        )
        check(
            "first target without baseline still wins",
            ActivityCheckWriteBack.baseline(duplicateWithoutBaseline).isEmpty
        )

        let booleanTimestamp = json.replacingOccurrences(
            of: "1700000000000",
            with: "true"
        )
        let stringTimestamp = json.replacingOccurrences(
            of: "1700000000000",
            with: #""1""#
        )
        check(
            "boolean and string timestamps are absent",
            ActivityCheckWriteBack.lastCheckedAt(booleanTimestamp).isEmpty
                && ActivityCheckWriteBack.lastCheckedAt(stringTimestamp).isEmpty
        )

        let updated = require(
            "valid read updates",
            ActivityCheckWriteBack.updated(
                json,
                reads: ["A": ["0.6", "0"], "B": nil],
                nowMs: 1_700_000_060_000
            )
        )
        let decoded = require("updated config decodes", ActivityCheckConfig.decode(updated))
        check("updated confirmed decodes", decoded.targets.first?.confirmed == "0.6")
        check(
            "updated timestamp is readable",
            ActivityCheckWriteBack.lastCheckedAt(updated) == ["A": 1_700_000_060_000]
        )
        check("URLs have unescaped slashes", !updated.contains(#"\/"#))

        let updatedObject = require("updated text is an object", jsonObject(updated))
        let targets = require("updated targets remain", updatedObject["targets"] as? [[String: Any]])
        let notice = require("notice remains", updatedObject["notice"] as? [String: Any])
        let unknown = require(
            "unknown top-level object remains",
            updatedObject["unknownTopLevel"] as? [String: Any]
        )
        check("B has no timestamp", targets[1]["lastCheckedAt"] == nil)
        check("second A timestamp is unchanged", (targets[2]["lastCheckedAt"] as? NSNumber)?.int64Value == 5)
        check("target extra key remains", targets[0]["targetExtra"] as? String == "kept")
        check("notice remains", notice["title"] as? String == "New activity")
        check("notice extra key remains", notice["noticeExtra"] as? Bool == true)
        check("unknown top-level key remains", (unknown["kept"] as? NSNumber)?.intValue == 7)

        check(
            "all nil reads do not update",
            ActivityCheckWriteBack.updated(json, reads: ["A": nil, "B": nil], nowMs: 1) == nil
        )
        check(
            "one string read does not update",
            ActivityCheckWriteBack.updated(json, reads: ["A": ["only"]], nowMs: 1) == nil
        )
        check(
            "three string read does not update",
            ActivityCheckWriteBack.updated(json, reads: ["A": ["one", "two", "three"]], nowMs: 1) == nil
        )
        check(
            "unknown address does not update",
            ActivityCheckWriteBack.updated(json, reads: ["C": ["1", "2"]], nowMs: 1) == nil
        )

        for invalid in ["not json", "[]"] {
            check(
                "invalid input does not update: \(invalid)",
                ActivityCheckWriteBack.updated(invalid, reads: ["A": ["1", "2"]], nowMs: 1) == nil
            )
            check(
                "invalid input has no timestamps: \(invalid)",
                ActivityCheckWriteBack.lastCheckedAt(invalid).isEmpty
            )
        }
        check("nil input has no timestamps", ActivityCheckWriteBack.lastCheckedAt(nil).isEmpty)
    }

    private static func target(
        address: String,
        confirmed: String?,
        pending: String?
    ) -> ActivityCheckConfig.Target {
        ActivityCheckConfig.Target(
            address: address,
            url: "https://example.test/address/\(address)",
            confirmedPath: "balances.confirmed",
            pendingPath: "balances.pending",
            confirmed: confirmed,
            pending: pending
        )
    }

    private static func jsonObject(_ json: String) -> [String: Any]? {
        guard
            let data = json.data(using: .utf8),
            let value = try? JSONSerialization.jsonObject(with: data)
        else {
            return nil
        }
        return value as? [String: Any]
    }

    private static func require<T>(_ name: String, _ value: T?) -> T {
        guard let value else {
            fail(name)
        }
        return value
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
