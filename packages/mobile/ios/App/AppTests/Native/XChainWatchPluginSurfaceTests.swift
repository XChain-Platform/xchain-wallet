// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import WatchConnectivity
import XCTest
@testable import App

final class XChainWatchPluginSurfaceTests: XCTestCase {
    func testBridgeSurfaceMatchesWatchContract() {
        let plugin = XChainWatchPlugin()

        XCTAssertEqual(plugin.identifier, "XChainWatchPlugin")
        XCTAssertEqual(plugin.jsName, "XChainWatch")
        XCTAssertEqual(plugin.pluginMethods.map(\.name), ["isAvailable", "status"])
        XCTAssertTrue(plugin.pluginMethods.allSatisfy { $0.returnType == CAPPluginReturnPromise })
    }

    func testStatusReportsActivatedLinkStateAndLastSync() {
        let plugin = XChainWatchPlugin()
        plugin.host = WatchSessionHost(session: PluginPhoneWatchSession(
            activationState: .activated,
            paired: true,
            installed: true,
            reachable: true
        ))
        plugin.lastSyncAt = 1_700_000_000_000

        let result = call(plugin, method: "status")

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?["paired"] as? Bool, true)
        XCTAssertEqual(result.data?["installed"] as? Bool, true)
        XCTAssertEqual(result.data?["reachable"] as? Bool, true)
        XCTAssertEqual(result.data?["lastSyncAt"] as? Int64, 1_700_000_000_000)
    }

    func testStatusGatesLinkStateWhenSessionIsNotActivated() {
        let plugin = XChainWatchPlugin()
        plugin.host = WatchSessionHost(session: PluginPhoneWatchSession(
            paired: true,
            installed: true,
            reachable: true
        ))
        plugin.lastSyncAt = nil

        let result = call(plugin, method: "status")

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?["paired"] as? Bool, false)
        XCTAssertEqual(result.data?["installed"] as? Bool, false)
        XCTAssertEqual(result.data?["reachable"] as? Bool, false)
        XCTAssertNil(result.data?["lastSyncAt"])
    }

    func testIsAvailableReflectsSessionSupport() {
        let plugin = XChainWatchPlugin()
        plugin.host = WatchSessionHost(session: PluginPhoneWatchSession())

        let supported = call(plugin, method: "isAvailable")

        plugin.host = WatchSessionHost(session: nil)
        let unsupported = call(plugin, method: "isAvailable")

        XCTAssertNil(supported.error)
        XCTAssertEqual(supported.data?["available"] as? Bool, true)
        XCTAssertNil(unsupported.error)
        XCTAssertEqual(unsupported.data?["available"] as? Bool, false)
    }

    private func call(
        _ plugin: XChainWatchPlugin,
        method: String
    ) -> (data: [String: Any]?, error: String?) {
        let done = expectation(description: "\(method) settles")
        var data: [String: Any]?
        var message: String?
        let call = CAPPluginCall(
            callbackId: "test-\(method)",
            methodName: method,
            options: [:],
            success: { result, _ in data = result?.data ?? [:]; done.fulfill() },
            error: { error in message = error?.message; done.fulfill() }
        )!
        if method == "status" {
            plugin.status(call)
        } else {
            plugin.isAvailable(call)
        }
        wait(for: [done], timeout: 5)
        return (data, message)
    }
}

private final class PluginPhoneWatchSession: PhoneWatchSession {
    weak var delegate: WCSessionDelegate?
    var activationState: WCSessionActivationState
    let isPaired: Bool
    let isWatchAppInstalled: Bool
    let isReachable: Bool

    init(
        activationState: WCSessionActivationState = .notActivated,
        paired: Bool = false,
        installed: Bool = false,
        reachable: Bool = false
    ) {
        self.activationState = activationState
        self.isPaired = paired
        self.isWatchAppInstalled = installed
        self.isReachable = reachable
    }

    func activate() {}
}
