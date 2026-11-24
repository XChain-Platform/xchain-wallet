// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct ActivityCheckPublicConfigCheck {
    private struct Refusal {
        let name: String
        let json: String?
    }

    static func main() {
        let input = #"{"enabled":true,"targets":[{"address":"alpha","url":"https://example.com/address/alpha","confirmedPath":"balances.confirmed","pendingPath":"balances.pending","confirmed":"1.5","pending":"0.25","privateKey":"secret"},{"address":"beta","url":"https://example.org/address/beta","confirmedPath":"balances.confirmed","pendingPath":"balances.pending"}],"notice":{"title":"New activity","body":"Your balance changed","extra":"drop me"},"openOnPhoneTitle":"Open on phone","mnemonic":"drop me"}"#
        let expected = #"{"enabled":true,"notice":{"body":"Your balance changed","title":"New activity"},"openOnPhoneTitle":"Open on phone","targets":[{"address":"alpha","confirmed":"1.5","confirmedPath":"balances.confirmed","pending":"0.25","pendingPath":"balances.pending","url":"https://example.com/address/alpha"},{"address":"beta","confirmedPath":"balances.confirmed","pendingPath":"balances.pending","url":"https://example.org/address/beta"}]}"#

        guard let sanitized = ActivityCheckPublicConfig.sanitize(input), sanitized == expected else {
            fail("valid config exact output")
        }
        guard
            ActivityCheckConfig.decode(sanitized) == ActivityCheckConfig.decode(input)
        else {
            fail("sanitized config decode equivalence")
        }
        guard
            !sanitized.contains("mnemonic"),
            !sanitized.contains("privateKey"),
            !sanitized.contains("extra")
        else {
            fail("private and unknown keys removed")
        }

        let emptyTargets = #"{"enabled":false,"targets":[],"notice":{"title":"New activity","body":"Your balance changed"},"openOnPhoneTitle":"Open on phone"}"#
        let expectedEmptyTargets = #"{"enabled":false,"notice":{"body":"Your balance changed","title":"New activity"},"openOnPhoneTitle":"Open on phone","targets":[]}"#
        guard ActivityCheckPublicConfig.sanitize(emptyTargets) == expectedEmptyTargets else {
            fail("empty targets kept")
        }

        let refusals = [
            Refusal(name: "nil", json: nil),
            Refusal(name: "empty string", json: ""),
            Refusal(name: "invalid JSON", json: "not json"),
            Refusal(name: "top-level array", json: "[]"),
            Refusal(name: "numeric enabled", json: #"{"enabled":1,"targets":[],"notice":{"title":"t","body":"b"},"openOnPhoneTitle":"o"}"#),
            Refusal(name: "string enabled", json: #"{"enabled":"true","targets":[],"notice":{"title":"t","body":"b"},"openOnPhoneTitle":"o"}"#),
            Refusal(name: "missing enabled", json: #"{"targets":[],"notice":{"title":"t","body":"b"},"openOnPhoneTitle":"o"}"#),
            Refusal(name: "object targets", json: #"{"enabled":true,"targets":{},"notice":{"title":"t","body":"b"},"openOnPhoneTitle":"o"}"#),
            Refusal(name: "string target", json: #"{"enabled":true,"targets":["target"],"notice":{"title":"t","body":"b"},"openOnPhoneTitle":"o"}"#),
            Refusal(name: "missing target URL", json: target(#""address":"a","confirmedPath":"c","pendingPath":"p""#)),
            Refusal(name: "numeric address", json: target(#""address":1,"url":"https://example.com","confirmedPath":"c","pendingPath":"p""#)),
            Refusal(name: "null confirmed", json: target(#""address":"a","url":"https://example.com","confirmedPath":"c","pendingPath":"p","confirmed":null"#)),
            Refusal(name: "numeric pending", json: target(#""address":"a","url":"https://example.com","confirmedPath":"c","pendingPath":"p","pending":1"#)),
            Refusal(name: "missing notice", json: #"{"enabled":true,"targets":[],"openOnPhoneTitle":"o"}"#),
            Refusal(name: "notice missing title", json: #"{"enabled":true,"targets":[],"notice":{"body":"b"},"openOnPhoneTitle":"o"}"#),
            Refusal(name: "missing open-on-phone title", json: #"{"enabled":true,"targets":[],"notice":{"title":"t","body":"b"}}"#),
            Refusal(name: "numeric open-on-phone title", json: #"{"enabled":true,"targets":[],"notice":{"title":"t","body":"b"},"openOnPhoneTitle":1}"#),
        ]

        for refusal in refusals {
            guard ActivityCheckPublicConfig.sanitize(refusal.json) == nil else {
                fail(refusal.name)
            }
        }
    }

    private static func target(_ fields: String) -> String {
        #"{"enabled":true,"targets":[{"# + fields + #"}],"notice":{"title":"t","body":"b"},"openOnPhoneTitle":"o"}"#
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        Foundation.exit(1)
    }
}
