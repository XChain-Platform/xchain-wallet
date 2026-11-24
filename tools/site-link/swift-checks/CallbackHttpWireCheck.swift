/*
 * Copyright © 2025–2026 Dankest, LLC
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Foundation

@main
struct CallbackHttpWireCheck {

    private static var passed = 0

    static func main() {
        let body = "{\"ok\":true,\"n\":\"é\"}"
        let ipv4 = CallbackPinnedTarget.make(
            href: "https://example.com/cb?x=1",
            address: [8, 8, 8, 8]
        )!
        let expectedIPv4 = """
        POST /cb?x=1 HTTP/1.1\r
        Host: example.com\r
        Content-Type: application/json\r
        Content-Length: 20\r
        Connection: close\r
        \r
        \(body)
        """
        check("IPv4 request bytes", request(ipv4, body) == Data(expectedIPv4.utf8))

        let ipv6: [UInt8] = [
            0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0,
            0, 0, 0, 0, 0, 0, 0x88, 0x88,
        ]
        let ipv6Target = CallbackPinnedTarget.make(
            href: "https://Example.COM:8443/a/b%20c",
            address: ipv6
        )!
        let expectedIPv6 = """
        POST /a/b%20c HTTP/1.1\r
        Host: Example.COM:8443\r
        Content-Type: application/json\r
        Content-Length: 2\r
        Connection: close\r
        \r
        {}
        """
        check("IPv6 request bytes", request(ipv6Target, "{}") == Data(expectedIPv6.utf8))

        check("oversized body", request(ipv4, String(repeating: "a", count: 10_241)) == nil)

        let refusedTargets: [(String, String, String)] = [
            ("request target space", "/a b", "example.com"),
            ("request target line break", "/a\r\nX: y", "example.com"),
            ("empty request target", "", "example.com"),
            ("host header line break", "/a", "example.com\r\nX: y"),
            ("empty host header", "/a", ""),
        ]
        for (name, requestTarget, hostHeader) in refusedTargets {
            check(name, request(target(requestTarget, hostHeader), "{}") == nil)
        }

        check("204 response", parse("HTTP/1.1 204 No Content\r\n\r\n") == .status(204))
        check("302 response", parse("HTTP/1.0 302 Found\r\nLocation: https://example.com/\r\n\r\n") == .status(302))
        check("500 response without reason", parse("HTTP/1.1 500\r\n\r\n") == .status(500))

        let earlyHints = "HTTP/1.1 103 Early Hints\r\nLink: </style.css>; rel=preload\r\n\r\n"
        check("103 then 200", parse(earlyHints + "HTTP/1.1 200 OK\r\n\r\n") == .status(200))
        check("lone 103", parse(earlyHints) == .incomplete)
        check("incomplete 200", parse("HTTP/1.1 200 OK\r\n") == .incomplete)
        check("oversized incomplete head", CallbackHttpWire.parseHead(
            Data(repeating: 65, count: CallbackHttpWire.maxHeadBytes + 1)
        ) == .malformed)

        let malformed = [
            "HTTP/2 200\r\n\r\n",
            "HTTP/1.1 20 OK\r\n\r\n",
            "HTTP/1.1 2000 OK\r\n\r\n",
            "HTTP/1.1 600 X\r\n\r\n",
            "XTTP/1.1 200 OK\r\n\r\n",
        ]
        for value in malformed {
            check("malformed response \(value.prefix(16))", parse(value) == .malformed)
        }
        check("response with body", parse("HTTP/1.1 204 No Content\r\n\r\nbody") == .status(204))

        print("CallbackHttpWireCheck: \(passed) passed, 0 failed")
    }

    private static func request(_ target: CallbackPinnedTarget, _ body: String) -> Data? {
        CallbackHttpWire.requestData(target: target, body: body)
    }

    private static func parse(_ text: String) -> CallbackHttpWire.Head {
        CallbackHttpWire.parseHead(Data(text.utf8))
    }

    private static func target(_ requestTarget: String, _ hostHeader: String) -> CallbackPinnedTarget {
        CallbackPinnedTarget(
            pinnedURL: URL(string: "https://8.8.8.8/")!,
            addressText: "8.8.8.8",
            port: 443,
            requestTarget: requestTarget,
            hostHeader: hostHeader,
            serverName: "example.com"
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
