/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackPostRequestCheck {

    private static var passed = 0

    static func main() {
        let href = "https://example.com/cb"
        let body = "payload"

        check("public IPv4", request(href: href, address: "8.8.8.8", body: body) == CallbackPostRequest(
            href: href,
            body: body,
            address: [8, 8, 8, 8]
        ))

        let ipv6: [UInt8] = [
            0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
            0, 0, 0, 0, 0, 0, 0x88, 0x88,
        ]
        check("public IPv6", request(href: href, address: "2001:4860:4860::8888", body: body)?.address == ipv6)
        check("bracketed public IPv6", request(
            href: href,
            address: "[2001:4860:4860::8888]",
            body: body
        )?.address == ipv6)

        let refusedAddresses: [(String, String?)] = [
            ("nil address", nil),
            ("name", "example.com"),
            ("short IPv4", "1.2.3"),
            ("long IPv4", "1.2.3.4.5"),
            ("IPv4 octet overflow", "256.1.1.1"),
            ("IPv4 suffix", "1.2.3.4x"),
            ("IPv6 non-hex", "g::1"),
            ("IPv6 zone", "fe80::1%en0"),
            ("private IPv4", "10.0.0.1"),
            ("mapped IPv4", "::ffff:8.8.8.8"),
            ("IPv6 loopback", "::1"),
        ]
        for (name, address) in refusedAddresses {
            check(name, request(href: href, address: address, body: body) == nil)
        }

        check("localhost production", request(
            href: "http://localhost:8080/cb",
            address: "127.0.0.1",
            body: body
        ) == nil)
        check("localhost developer", request(
            href: "http://localhost:8080/cb",
            address: "127.0.0.1",
            body: body,
            developerMode: true
        ) != nil)

        check("follow redirect", request(href: href, address: "8.8.8.8", body: body, redirect: "follow") == nil)
        check("included credentials", request(
            href: href,
            address: "8.8.8.8",
            body: body,
            credentials: "include"
        ) == nil)

        for timeout in [0, -1, .nan] as [Double] {
            check("timeout \(timeout)", request(href: href, address: "8.8.8.8", body: body, timeoutMs: timeout) == nil)
        }
        check("nil timeout", request(href: href, address: "8.8.8.8", body: body, timeoutMs: nil) == nil)

        check("remote http", request(href: "http://example.com/cb", address: "8.8.8.8", body: body) == nil)
        check("fragment", request(href: "https://example.com/cb#x", address: "8.8.8.8", body: body) == nil)
        check("oversized body", request(
            href: href,
            address: "8.8.8.8",
            body: String(repeating: "a", count: 10_241)
        ) == nil)
        check("nil href", request(href: nil, address: "8.8.8.8", body: body) == nil)
        check("nil body", request(href: href, address: "8.8.8.8", body: nil) == nil)

        print("CallbackPostRequestCheck: \(passed) passed, 0 failed")
    }

    private static func request(
        href: String?,
        address: String?,
        body: String?,
        timeoutMs: Double? = 10_000,
        redirect: String? = "manual",
        credentials: String? = "omit",
        developerMode: Bool = false
    ) -> CallbackPostRequest? {
        CallbackPostRequest.check(
            href: href,
            address: address,
            body: body,
            timeoutMs: timeoutMs,
            redirect: redirect,
            credentials: credentials,
            developerMode: developerMode
        )
    }

    private static func check(_ name: String, _ condition: Bool) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }
}
