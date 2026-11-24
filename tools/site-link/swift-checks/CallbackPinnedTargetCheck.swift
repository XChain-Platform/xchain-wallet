/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackPinnedTargetCheck {

    private static var passed = 0

    static func main() {
        let ipv4: [UInt8] = [8, 8, 8, 8]
        let ipv6: [UInt8] = [
            0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
            0, 0, 0, 0, 0, 0, 0x88, 0x88,
        ]
        let documentationIPv6: [UInt8] = [
            0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 1,
        ]

        check("named IPv4 target", target("https://example.com/cb?x=1", ipv4) == CallbackPinnedTarget(
            pinnedURL: URL(string: "https://8.8.8.8/cb?x=1")!,
            addressText: "8.8.8.8",
            port: 443,
            requestTarget: "/cb?x=1",
            hostHeader: "example.com",
            serverName: "example.com"
        ))
        check("named IPv6 target", target(
            "https://Example.COM:8443/a/b%20c",
            ipv6
        ) == CallbackPinnedTarget(
            pinnedURL: URL(string: "https://[2001:4860:4860::8888]:8443/a/b%20c")!,
            addressText: "2001:4860:4860::8888",
            port: 8443,
            requestTarget: "/a/b%20c",
            hostHeader: "Example.COM:8443",
            serverName: "example.com"
        ))

        let defaultPort = target("https://example.com:443", ipv4)
        check("explicit default port target", defaultPort?.requestTarget == "/")
        check("explicit default port header", defaultPort?.hostHeader == "example.com")
        check("uppercase scheme", target("HTTPS://example.com/cb", ipv4) != nil)

        let preserved = target("HTTPS://Example.COM:0443/a%2Fb?q=%2f&empty=", ipv4)
        check(
            "raw URL preservation",
            preserved?.pinnedURL.absoluteString == "HTTPS://8.8.8.8:0443/a%2Fb?q=%2f&empty="
        )
        check("raw request target", preserved?.requestTarget == "/a%2Fb?q=%2f&empty=")
        check("normalized default port header", preserved?.hostHeader == "Example.COM")

        let emptyPathQuery = target("https://example.com?x=%2F", ipv4)
        check("empty path query target", emptyPathQuery?.requestTarget == "/?x=%2F")

        let ipv4Literal = target("https://8.8.8.8/cb", ipv4)
        check("matching IPv4 literal", ipv4Literal?.serverName == nil)
        check("mismatched IPv4 literal", target("https://8.8.8.8/cb", [1, 1, 1, 1]) == nil)

        let ipv6Literal = target("https://[2001:db8::1]/cb", documentationIPv6)
        check("matching IPv6 literal header", ipv6Literal?.hostHeader == "[2001:db8::1]")
        check("matching IPv6 literal server name", ipv6Literal?.serverName == nil)
        check("mismatched IPv6 literal", target("https://[2001:db8::1]/cb", ipv4) == nil)

        let refused: [(String, String?, [UInt8]?)] = [
            ("http scheme", "http://example.com/cb", ipv4),
            ("credentials", "https://u:p@example.com/cb", ipv4),
            ("fragment", "https://example.com/cb#x", ipv4),
            ("missing host", "https:///cb", ipv4),
            ("malformed URL", "not a url", ipv4),
            ("nil href", nil, ipv4),
            ("nil address", "https://example.com/cb", nil),
            ("invalid address length", "https://example.com/cb", [1, 2, 3, 4, 5]),
        ]
        for (name, href, address) in refused {
            check(name, target(href, address) == nil)
        }

        print("CallbackPinnedTargetCheck: \(passed) passed, 0 failed")
    }

    private static func target(_ href: String?, _ address: [UInt8]?) -> CallbackPinnedTarget? {
        CallbackPinnedTarget.make(href: href, address: address)
    }

    private static func check(_ name: String, _ condition: Bool) {
        guard condition else {
            FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
            exit(1)
        }
        passed += 1
    }
}
