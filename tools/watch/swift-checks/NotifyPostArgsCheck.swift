// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct NotifyPostArgsCheck {
    static func main() {
        let valid = NotifyPostArgs(
            id: "post-1",
            title: "Payment received",
            body: "10 XRP",
            family: "incomingReceipts",
            sound: .file("glass.caf"),
            category: "alert",
            threadId: "account-1"
        )
        let validValues: [String: Any] = [
            "id": "post-1",
            "title": "Payment received",
            "body": "10 XRP",
            "family": "incomingReceipts",
            "sound": "glass",
            "category": "alert",
            "threadId": "account-1",
        ]

        check("full valid post", NotifyPostArgs.parse(validValues) == valid)
        check("missing id", parseWithout("id", from: validValues) == nil)
        check("empty id", parseReplacing("id", with: "", in: validValues) == nil)
        check("numeric id", parseReplacing("id", with: 1, in: validValues) == nil)
        check("missing title", parseWithout("title", from: validValues) == nil)
        check("empty title", parseReplacing("title", with: "", in: validValues) == nil)
        check("numeric title", parseReplacing("title", with: 1, in: validValues) == nil)
        check("unknown family", parseReplacing("family", with: "unknown", in: validValues) == nil)
        check(
            "family case variant",
            parseReplacing("family", with: "IncomingReceipts", in: validValues) == nil
        )
        check(
            "request family",
            parseReplacing("family", with: "request", in: validValues)?.family == "request"
        )
        check(
            "paydue family",
            parseReplacing("family", with: "paydue", in: validValues)?.family == "paydue"
        )

        for category in ["request", "paydue", "alert"] {
            check(
                "\(category) category",
                parseReplacing("category", with: category, in: validValues)?.category == category
            )
        }
        check(
            "unknown category",
            parseReplacing("category", with: "unknown", in: validValues) == nil
        )

        check(
            "chime sound",
            parseReplacing("sound", with: "chime", in: validValues)?.sound == .file("chime.caf")
        )
        check(
            "silent sound",
            parseReplacing("sound", with: "none", in: validValues)?.sound == .silent
        )
        check(
            "absent sound",
            parseWithout("sound", from: validValues)?.sound == .systemDefault
        )
        check(
            "unknown sound",
            parseReplacing("sound", with: "trumpet", in: validValues)?.sound == .systemDefault
        )

        let defaults = NotifyPostArgs.parse([
            "id": "post-2",
            "title": "Request",
            "family": "request",
        ])
        check("body default", defaults?.body == "")
        check("thread default", defaults?.threadId == "request")
    }

    private static func parseWithout(
        _ key: String,
        from values: [String: Any]
    ) -> NotifyPostArgs? {
        var changed = values
        changed.removeValue(forKey: key)
        return NotifyPostArgs.parse(changed)
    }

    private static func parseReplacing(
        _ key: String,
        with value: Any,
        in values: [String: Any]
    ) -> NotifyPostArgs? {
        var changed = values
        changed[key] = value
        return NotifyPostArgs.parse(changed)
    }

    private static func check(_ name: String, _ passed: @autoclosure () -> Bool) {
        guard passed() else {
            FileHandle.standardError.write(Data("failed: \(name)\n".utf8))
            exit(1)
        }
    }
}
