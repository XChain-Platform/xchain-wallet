// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import Foundation
import XCTest
@testable import App

private final class PluginHostLookup {
    private let lock = NSLock()
    private let answer: [[UInt8]]?
    private var recordedHosts: [String] = []
    private var recordedThread: ObjectIdentifier?

    init(_ answer: [[UInt8]]?) {
        self.answer = answer
    }

    func lookup(_ host: String) -> [[UInt8]]? {
        lock.lock()
        recordedHosts.append(host)
        recordedThread = ObjectIdentifier(Thread.current)
        lock.unlock()
        return answer
    }

    var hosts: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedHosts
    }

    var thread: ObjectIdentifier? {
        lock.lock()
        defer { lock.unlock() }
        return recordedThread
    }
}

final class XChainLinksPluginHostTests: XCTestCase {
    func testBridgeSurfaceAndDefaultLookupMatchContract() {
        let plugin = XChainLinksPlugin()

        XCTAssertEqual(plugin.identifier, "XChainLinksPlugin")
        XCTAssertEqual(plugin.jsName, "XChainLinks")
        XCTAssertEqual(plugin.pluginMethods.map(\.name), ["takePendingLink", "resolveHost"])
        XCTAssertTrue(plugin.pluginMethods.allSatisfy { $0.returnType == CAPPluginReturnPromise })
        XCTAssertEqual(
            plugin.hostLookup("127.0.0.1"),
            CallbackResolve.systemLookup("127.0.0.1")
        )
    }

    func testResolveHostPreservesAddressOrderOffCallingThread() {
        let callingThread = ObjectIdentifier(Thread.current)
        let lookup = PluginHostLookup([[8, 8, 8, 8], [1, 1, 1, 1]])
        let plugin = XChainLinksPlugin()
        plugin.hostLookup = lookup.lookup

        let result = call(plugin, options: ["host": "callback.example"])

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?["addresses"] as? [String], ["8.8.8.8", "1.1.1.1"])
        XCTAssertEqual(lookup.hosts, ["callback.example"])
        XCTAssertNotEqual(lookup.thread, callingThread)
    }

    func testResolveHostRemovesIPv6BracketsAndFormatsEveryWord() {
        let lookup = PluginHostLookup([[
            0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 1,
        ]])
        let plugin = XChainLinksPlugin()
        plugin.hostLookup = lookup.lookup

        let result = call(plugin, options: ["host": "[2001:db8::1]"])

        XCTAssertNil(result.error)
        XCTAssertEqual(
            result.data?["addresses"] as? [String],
            ["2001:db8:0:0:0:0:0:1"]
        )
        XCTAssertEqual(lookup.hosts, ["2001:db8::1"])
    }

    func testResolveHostRejectsUnusableLookupAnswers() {
        let answers: [(String, [[UInt8]]?)] = [
            ("nil", nil),
            ("empty", []),
            ("malformed", [[1, 2, 3, 4, 5]]),
        ]

        for (name, answer) in answers {
            let lookup = PluginHostLookup(answer)
            let plugin = XChainLinksPlugin()
            plugin.hostLookup = lookup.lookup

            let result = call(plugin, options: ["host": "callback.example"], label: name)

            XCTAssertNil(result.data)
            XCTAssertEqual(result.error, "Callback host lookup failed")
            XCTAssertEqual(lookup.hosts, ["callback.example"])
        }
    }

    func testResolveHostRejectsMissingAndBlankHostWithoutLookup() {
        for (name, options) in [
            ("missing", [String: Any]()),
            ("blank", ["host": " \n\t"]),
        ] {
            let lookup = PluginHostLookup([[8, 8, 8, 8]])
            let plugin = XChainLinksPlugin()
            plugin.hostLookup = lookup.lookup

            let result = call(plugin, options: options, label: name)

            XCTAssertNil(result.data)
            XCTAssertEqual(result.error, "Callback host lookup failed")
            XCTAssertTrue(lookup.hosts.isEmpty)
        }
    }

    private func call(
        _ plugin: XChainLinksPlugin,
        options: [String: Any],
        label: String = "resolveHost"
    ) -> (data: [String: Any]?, error: String?) {
        let done = expectation(description: "\(label) settles")
        var data: [String: Any]?
        var message: String?
        let call = CAPPluginCall(
            callbackId: "test-\(label)",
            methodName: "resolveHost",
            options: JSTypes.coerceDictionaryToJSObject(options) ?? [:],
            success: { result, _ in data = result?.data ?? [:]; done.fulfill() },
            error: { error in message = error?.message; done.fulfill() }
        )!

        plugin.resolveHost(call)

        wait(for: [done], timeout: 5)
        return (data, message)
    }
}
