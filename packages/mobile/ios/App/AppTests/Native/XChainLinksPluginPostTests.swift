// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import Foundation
import XCTest
@testable import App

private final class PluginPostScriptedChannel: CallbackChannel {
    private let startResult: Bool
    private let response: Data

    init(startResult: Bool = true, response: String = "") {
        self.startResult = startResult
        self.response = Data(response.utf8)
    }

    func start(_ ready: @escaping (Bool) -> Void) { ready(startResult) }

    func send(_ data: Data, _ done: @escaping (Bool) -> Void) { done(true) }

    func receive(_ handler: @escaping (Data?, Bool, Bool) -> Void) {
        handler(response, true, false)
    }

    func cancel() {}
}

private final class PluginPostChannelFactory {
    private let lock = NSLock()
    private let channel: CallbackChannel
    private var recordedPlans: [CallbackPostPlan] = []

    init(_ channel: CallbackChannel) {
        self.channel = channel
    }

    func make(_ plan: CallbackPostPlan, queue: DispatchQueue) -> CallbackChannel {
        lock.lock()
        recordedPlans.append(plan)
        lock.unlock()
        return channel
    }

    var plans: [CallbackPostPlan] {
        lock.lock()
        defer { lock.unlock() }
        return recordedPlans
    }
}

final class XChainLinksPluginPostTests: XCTestCase {
    private let href = "https://example.com/cb?x=1"
    private let address = "8.8.8.8"
    private let body = "{\"ok\":true}"

    func testPostIsAPromiseMethod() {
        let method = XChainLinksPlugin().pluginMethods.first { $0.name == "post" }

        XCTAssertNotNil(method)
        XCTAssertTrue(method?.returnType == CAPPluginReturnPromise)
    }

    func testAcceptedRequestResolvesExactStatusAndBuildsExpectedPlan() {
        let factory = PluginPostChannelFactory(PluginPostScriptedChannel(
            response: "HTTP/1.1 204 No Content\r\n\r\n"
        ))
        let result = invoke(options: validOptions(), factory: factory)
        let expected = CallbackPostPlan.make(
            href: href, address: address, body: body, timeoutMs: 10_000,
            redirect: "manual", credentials: "omit", developerMode: false
        )

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?.count, 1)
        XCTAssertEqual(result.data?["status"] as? Int, 204)
        XCTAssertEqual(factory.plans, [expected].compactMap { $0 })
    }

    func testServerErrorResolvesExactStatus() {
        let factory = PluginPostChannelFactory(PluginPostScriptedChannel(
            response: "HTTP/1.1 500 Internal Server Error\r\n\r\n"
        ))
        let result = invoke(options: validOptions(), factory: factory)

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?.count, 1)
        XCTAssertEqual(result.data?["status"] as? Int, 500)
        XCTAssertEqual(factory.plans.count, 1)
    }

    func testRefusedRequestsRejectWithoutCreatingChannel() {
        var redirect = validOptions()
        redirect["redirect"] = "follow"
        var loopback = validOptions()
        loopback["address"] = "127.0.0.1"

        for (name, options) in [("redirect", redirect), ("loopback", loopback)] {
            let factory = PluginPostChannelFactory(PluginPostScriptedChannel())
            let result = invoke(options: options, factory: factory, label: name)

            XCTAssertNil(result.data, name)
            XCTAssertEqual(result.error, "Callback request refused", name)
            XCTAssertTrue(factory.plans.isEmpty, name)
        }
    }

    func testFailedChannelStartRejectsExactMessage() {
        let factory = PluginPostChannelFactory(PluginPostScriptedChannel(startResult: false))
        let result = invoke(options: validOptions(), factory: factory)

        XCTAssertNil(result.data)
        XCTAssertEqual(result.error, "Callback POST failed")
        XCTAssertEqual(factory.plans.count, 1)
    }

    private func validOptions() -> [String: Any] {
        [
            "href": href,
            "address": address,
            "body": body,
            "timeoutMs": 10_000.0,
            "redirect": "manual",
            "credentials": "omit",
        ]
    }

    private func invoke(
        options: [String: Any],
        factory: PluginPostChannelFactory,
        label: String = "post"
    ) -> (data: [String: Any]?, error: String?) {
        let done = expectation(description: "\(label) settles")
        var data: [String: Any]?
        var message: String?
        var settlements = 0
        let call = CAPPluginCall(
            callbackId: "test-\(label)",
            methodName: "post",
            options: JSTypes.coerceDictionaryToJSObject(options) ?? [:],
            success: { result, _ in
                settlements += 1
                data = result?.data ?? [:]
                done.fulfill()
            },
            error: { error in
                settlements += 1
                message = error?.message
                done.fulfill()
            }
        )!
        let plugin = XChainLinksPlugin()
        plugin.postChannel = factory.make

        plugin.post(call)

        wait(for: [done], timeout: 5)
        CallbackPostBridge.queue.sync {}
        XCTAssertEqual(settlements, 1, label)
        return (data, message)
    }
}
