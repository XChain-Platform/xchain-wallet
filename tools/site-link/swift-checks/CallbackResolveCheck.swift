/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackResolveCheck {

    private static var passed = 0

    static func main() {
        check("public address", CallbackResolve.check(
            host: "example.test",
            developerMode: false,
            lookup: { _ in [[8, 8, 8, 8]] }
        ) == .address([8, 8, 8, 8]))

        check("mixed public and refused answers", CallbackResolve.check(
            host: "example.test",
            developerMode: false,
            lookup: { _ in [[8, 8, 8, 8], [10, 0, 0, 1]] }
        ) == .refusedAddress)

        check("loopback refused", CallbackResolve.check(
            host: "localhost",
            developerMode: false,
            lookup: { _ in [[127, 0, 0, 1]] }
        ) == .refusedAddress)

        check("loopback allowed in Developer Mode", CallbackResolve.check(
            host: "localhost",
            developerMode: true,
            lookup: { _ in [[127, 0, 0, 1]] }
        ) == .address([127, 0, 0, 1]))

        check("nil answer", CallbackResolve.check(
            host: "example.test",
            developerMode: false,
            lookup: { _ in nil }
        ) == .resolveFailed)

        check("empty answer", CallbackResolve.check(
            host: "example.test",
            developerMode: false,
            lookup: { _ in [] }
        ) == .resolveFailed)

        var invalidHostLookupCalls = 0
        let invalidHostLookup: CallbackResolve.Lookup = { _ in
            invalidHostLookupCalls += 1
            return [[8, 8, 8, 8]]
        }
        check("nil host", CallbackResolve.check(
            host: nil,
            developerMode: false,
            lookup: invalidHostLookup
        ) == .resolveFailed)
        check("empty host", CallbackResolve.check(
            host: "",
            developerMode: false,
            lookup: invalidHostLookup
        ) == .resolveFailed)
        check("blank host", CallbackResolve.check(
            host: " \t\n",
            developerMode: false,
            lookup: invalidHostLookup
        ) == .resolveFailed)
        check("invalid hosts skip lookup", invalidHostLookupCalls == 0)

        var bracketLookupHost: String?
        let bracketOutcome = CallbackResolve.check(
            host: "[2001:4860:4860::8888]",
            developerMode: false,
            lookup: { host in
                bracketLookupHost = host
                return [[
                    0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
                    0, 0, 0, 0, 0, 0, 0x88, 0x88
                ]]
            }
        )
        check("bracketed IPv6 host", bracketLookupHost == "2001:4860:4860::8888")
        check("bracketed IPv6 outcome", bracketOutcome == .address([
            0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
            0, 0, 0, 0, 0, 0, 0x88, 0x88
        ]))

        check("system IPv4 literal", CallbackResolve.systemLookup("8.8.8.8")?
            .contains([8, 8, 8, 8]) == true)
        check("system IPv6 literal", CallbackResolve.systemLookup("::1")?
            .contains(Array(repeating: 0, count: 15) + [1]) == true)
        check("system localhost refused", CallbackResolve.check(
            host: "localhost",
            developerMode: false,
            lookup: CallbackResolve.systemLookup
        ) == .refusedAddress)

        print("CallbackResolveCheck: \(passed) passed, 0 failed")
    }

    private static func check(_ name: String, _ condition: Bool) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }
}
