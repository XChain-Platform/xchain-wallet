// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import Foundation

@main
struct CallbackPostRuleCheck {
    static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }

    static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    static func literal(
        in path: String,
        pattern: String,
        name: String
    ) -> Int {
        guard let source = try? String(contentsOfFile: path, encoding: .utf8),
              let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(
                  in: source,
                  range: NSRange(source.startIndex..., in: source)
              ),
              let range = Range(match.range(at: 1), in: source),
              let value = Int(source[range])
        else {
            fail(name)
        }
        return value
    }

    static func main() {
        let callbackSend = "packages/core/src/site_request/callbackSend.js"
        let claim = "packages/core/src/site_request/claim.js"

        let timeoutMs = literal(
            in: callbackSend,
            pattern: #"CALLBACK_TIMEOUT_MS\s*=\s*(\d+)"#,
            name: "read CALLBACK_TIMEOUT_MS"
        )
        let maxBodyBytes = literal(
            in: claim,
            pattern: #"CALLBACK_BODY_MAX_BYTES\s*=\s*(\d+)"#,
            name: "read CALLBACK_BODY_MAX_BYTES"
        )
        let maxTargetLength = literal(
            in: callbackSend,
            pattern: #"url\.length\s*>\s*(\d+)"#,
            name: "read callback target length"
        )

        require(CallbackPostRule.timeoutMs == timeoutMs, "timeoutMs literal")
        require(CallbackPostRule.maxBodyBytes == maxBodyBytes, "maxBodyBytes literal")
        require(CallbackPostRule.maxTargetLength == maxTargetLength, "maxTargetLength literal")

        require(CallbackPostRule.acceptsTarget("https://example.com/cb", developerMode: false), "https production")
        require(CallbackPostRule.acceptsTarget("https://example.com/cb", developerMode: true), "https developer")

        let localTargets = [
            "http://localhost:8080/cb",
            "http://127.0.0.1/cb",
            "http://[::1]:3000/cb",
        ]
        for target in localTargets {
            require(!CallbackPostRule.acceptsTarget(target, developerMode: false), "local production \(target)")
            require(CallbackPostRule.acceptsTarget(target, developerMode: true), "local developer \(target)")
        }

        require(!CallbackPostRule.acceptsTarget("http://example.com/cb", developerMode: true), "remote http")
        require(!CallbackPostRule.acceptsTarget("https://user:pass@example.com/", developerMode: false), "credentials")
        require(!CallbackPostRule.acceptsTarget("https://example.com/#x", developerMode: false), "fragment")
        require(!CallbackPostRule.acceptsTarget("javascript:alert(1)", developerMode: false), "javascript")
        require(!CallbackPostRule.acceptsTarget("ftp://example.com/", developerMode: false), "ftp")
        require(!CallbackPostRule.acceptsTarget(nil, developerMode: false), "nil target")

        let prefix = "https://example.com/"
        let target2048 = prefix + String(repeating: "a", count: 2048 - prefix.utf16.count)
        let target2049 = target2048 + "a"
        require(CallbackPostRule.acceptsTarget(target2048, developerMode: false), "2048-char target")
        require(!CallbackPostRule.acceptsTarget(target2049, developerMode: false), "2049-char target")

        require(CallbackPostRule.bodyFits(String(repeating: "a", count: 10240)), "10240-byte body")
        require(!CallbackPostRule.bodyFits(String(repeating: "a", count: 10241)), "10241-byte body")
        require(!CallbackPostRule.bodyFits(String(repeating: "€", count: 3414)), "three-byte body")
        require(!CallbackPostRule.bodyFits(nil), "nil body")

        for status in [200, 204, 299] {
            require(CallbackPostRule.outcome(status: status) == "SENT", "sent status \(status)")
        }
        for status in [199, 302, 304, 404, 500] {
            require(CallbackPostRule.outcome(status: status) == "HTTP_STATUS", "http status \(status)")
        }

        print("PASS: CallbackPostRule")
    }
}
