/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackPostPlanCheck {
    private static var passed = 0

    static func main() {
        let href = "https://example.com/cb?x=1"
        let body = "{\"ok\":true}"
        let expectedTarget = requireTarget(href, [8, 8, 8, 8])
        let ipv4 = requirePlan(href: href, address: "8.8.8.8", body: body)
        check("IPv4 target", ipv4.target == expectedTarget)
        check("DNS trust name", ipv4.trustName == "example.com")
        check(
            "request bytes",
            ipv4.requestData == CallbackHttpWire.requestData(target: expectedTarget, body: body)
        )

        let literal = requirePlan(href: "https://8.8.8.8/cb", address: "8.8.8.8")
        check("IPv4 trust name", literal.trustName == "8.8.8.8")

        let ipv6Bytes: [UInt8] = [
            0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
            0, 0, 0, 0, 0, 0, 0x88, 0x88,
        ]
        let ipv6Href = "https://example.com/cb"
        let ipv6Target = requireTarget(ipv6Href, ipv6Bytes)
        let ipv6 = requirePlan(href: ipv6Href, address: "2001:4860:4860::8888")
        check("IPv6 address text", ipv6.target.addressText == ipv6Target.addressText)

        check("follow redirect", plan(redirect: "follow") == nil)
        check("included credentials", plan(credentials: "include") == nil)
        check("nil timeout", plan(timeoutMs: nil) == nil)
        check("zero timeout", plan(timeoutMs: 0) == nil)
        check("refused address", plan(address: "127.0.0.1") == nil)
        check("name address", plan(address: "example.com") == nil)
        check("nil body", plan(body: nil) == nil)
        check("oversized body", plan(body: String(repeating: "a", count: 10_241)) == nil)
        check(
            "mismatched literal",
            plan(href: "https://1.1.1.1/cb", address: "8.8.8.8") == nil
        )
        check(
            "Developer Mode HTTP",
            plan(
                href: "http://localhost:8080/cb",
                address: "127.0.0.1",
                developerMode: true
            ) == nil
        )

        check("refused message", CallbackPostPlan.refusedMessage == "Callback request refused")
        check("failed message", CallbackPostPlan.failedMessage == "Callback POST failed")
        check("204 incomplete", step(.status(204), false) == .resolve(204))
        check("204 complete", step(.status(204), true) == .resolve(204))
        check("302 status", step(.status(302), false) == .resolve(302))
        check("malformed incomplete", step(.malformed, false) == .fail)
        check("malformed complete", step(.malformed, true) == .fail)
        check("read more", step(.incomplete, false) == .readMore)
        check("incomplete at EOF", step(.incomplete, true) == .fail)

        print("CallbackPostPlanCheck: \(passed) passed, 0 failed")
    }

    private static func plan(
        href: String? = "https://example.com/cb",
        address: String? = "8.8.8.8",
        body: String? = "{}",
        timeoutMs: Double? = 10_000,
        redirect: String? = "manual",
        credentials: String? = "omit",
        developerMode: Bool = false
    ) -> CallbackPostPlan? {
        CallbackPostPlan.make(
            href: href,
            address: address,
            body: body,
            timeoutMs: timeoutMs,
            redirect: redirect,
            credentials: credentials,
            developerMode: developerMode
        )
    }

    private static func requirePlan(
        href: String,
        address: String,
        body: String = "{}"
    ) -> CallbackPostPlan {
        guard let value = plan(href: href, address: address, body: body) else {
            fail("make plan for \(href)")
        }
        return value
    }

    private static func requireTarget(_ href: String, _ address: [UInt8]) -> CallbackPinnedTarget {
        guard let value = CallbackPinnedTarget.make(href: href, address: address) else {
            fail("make target for \(href)")
        }
        return value
    }

    private static func step(
        _ head: CallbackHttpWire.Head,
        _ isComplete: Bool
    ) -> CallbackPostPlan.Step {
        CallbackPostPlan.step(head: head, isComplete: isComplete)
    }

    private static func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        guard condition() else { fail(name) }
        passed += 1
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
