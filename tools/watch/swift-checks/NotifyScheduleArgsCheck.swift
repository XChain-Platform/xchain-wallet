// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct NotifyScheduleArgsCheck {
    static func main() {
        let values: [String: Any] = [
            "id": "deadline:order-1",
            "title": "Order deadline",
            "family": "deadlines",
            "sound": NSNull(),
            "category": "alert",
            "threadId": "deadlines",
            "actions": [Any](),
            "at": NSNumber(value: 1_767_225_600_000 as Int64),
        ]

        guard let expectedPost = NotifyPostArgs.parse(values) else {
            fail("valid post")
        }
        guard
            NotifyScheduleArgs.parse(values) == NotifyScheduleArgs(
                post: expectedPost,
                atMs: 1_767_225_600_000
            )
        else {
            fail("NSNumber at")
        }

        var intValues = values
        intValues["at"] = 1_767_225_600_000
        guard NotifyScheduleArgs.parse(intValues)?.atMs == 1_767_225_600_000 else {
            fail("Int at")
        }

        var fractionalValues = values
        fractionalValues["at"] = 1_767_225_600_000.75
        guard NotifyScheduleArgs.parse(fractionalValues)?.atMs == 1_767_225_600_000 else {
            fail("fractional at")
        }

        var invalidValues = values
        invalidValues.removeValue(forKey: "at")
        expectNil(invalidValues, "missing at")

        let invalidAtValues: [(Any, String)] = [
            (NSNull(), "null at"),
            ("1767225600000", "string at"),
            (NSNumber(value: true), "boolean at"),
            (Double.nan, "NaN at"),
            (Double.infinity, "infinite at"),
            (0, "zero at"),
            (-1, "negative at"),
            (9_007_199_254_740_992 as Int64, "unsafe at"),
        ]
        for (at, name) in invalidAtValues {
            invalidValues = values
            invalidValues["at"] = at
            expectNil(invalidValues, name)
        }

        invalidValues = values
        invalidValues["id"] = ""
        expectNil(invalidValues, "empty id")

        invalidValues = values
        invalidValues["family"] = "unknown"
        expectNil(invalidValues, "unknown family")

        guard NotifyScheduleArgs.cancelId(["id": "deadline:order-1"]) == "deadline:order-1" else {
            fail("cancel valid id")
        }
        guard NotifyScheduleArgs.cancelId([:]) == nil else {
            fail("cancel missing id")
        }
        guard NotifyScheduleArgs.cancelId(["id": ""]) == nil else {
            fail("cancel empty id")
        }
        guard NotifyScheduleArgs.cancelId(["id": 1]) == nil else {
            fail("cancel numeric id")
        }
    }

    private static func expectNil(_ values: [String: Any], _ name: String) {
        guard NotifyScheduleArgs.parse(values) == nil else {
            fail(name)
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("failed: \(name)\n".utf8))
        exit(1)
    }
}
