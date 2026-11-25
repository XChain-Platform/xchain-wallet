/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackHostAnswerCheck {

    private static var passed = 0

    static func main() {
        var orderedLookupCalls = 0
        check("ordered IPv4 answers", CallbackHostAnswer.addresses(
            host: "dns.test",
            lookup: { _ in
                orderedLookupCalls += 1
                return [[8, 8, 8, 8], [1, 1, 1, 1]]
            }
        ) == ["8.8.8.8", "1.1.1.1"])
        check("lookup called once", orderedLookupCalls == 1)

        check("IPv4 decimal", CallbackHostAnswer.addresses(
            host: "private.test",
            lookup: { _ in [[10, 0, 0, 1]] }
        ) == ["10.0.0.1"])

        check("IPv6 expanded", CallbackHostAnswer.addresses(
            host: "ipv6.test",
            lookup: { _ in [[
                0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
                0, 0, 0, 0, 0, 0, 0x88, 0x88
            ]] }
        ) == ["2001:4860:4860:0:0:0:0:8888"])

        check("IPv6 loopback expanded", CallbackHostAnswer.addresses(
            host: "loopback.test",
            lookup: { _ in [Array(repeating: 0, count: 15) + [1]] }
        ) == ["0:0:0:0:0:0:0:1"])

        var bracketLookupHost: String?
        let bracketAnswer = CallbackHostAnswer.addresses(
            host: "[2001:db8::1]",
            lookup: { host in
                bracketLookupHost = host
                return [[
                    0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0,
                    0, 0, 0, 0, 0, 0, 0, 1
                ]]
            }
        )
        check("bracketed host lookup", bracketLookupHost == "2001:db8::1")
        check("bracketed host answer", bracketAnswer == ["2001:db8:0:0:0:0:0:1"])

        check("nil answer", CallbackHostAnswer.addresses(
            host: "nil.test",
            lookup: { _ in nil }
        ) == nil)
        check("empty answer", CallbackHostAnswer.addresses(
            host: "empty.test",
            lookup: { _ in [] }
        ) == nil)
        check("invalid byte count", CallbackHostAnswer.addresses(
            host: "invalid.test",
            lookup: { _ in [[1, 2, 3, 4, 5]] }
        ) == nil)

        var invalidHostLookupCalls = 0
        let invalidHostLookup: CallbackResolve.Lookup = { _ in
            invalidHostLookupCalls += 1
            return [[8, 8, 8, 8]]
        }
        check("nil host", CallbackHostAnswer.addresses(
            host: nil,
            lookup: invalidHostLookup
        ) == nil)
        check("empty host", CallbackHostAnswer.addresses(
            host: "",
            lookup: invalidHostLookup
        ) == nil)
        check("blank host", CallbackHostAnswer.addresses(
            host: " \t\n",
            lookup: invalidHostLookup
        ) == nil)
        check("invalid hosts skip lookup", invalidHostLookupCalls == 0)

        print("CallbackHostAnswerCheck: \(passed) passed, 0 failed")
    }

    private static func check(_ name: String, _ condition: Bool) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }
}
