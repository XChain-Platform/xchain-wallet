// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import Foundation
import XCTest
@testable import App

private final class BridgeScriptedChannel: CallbackChannel {
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

private final class BridgeChannelFactory {
    private let lock = NSLock()
    private let channel: CallbackChannel
    private var recordedPlans: [CallbackPostPlan] = []
    private var recordedThread: ObjectIdentifier?
    private var recordedQueue: DispatchQueue?

    init(_ channel: CallbackChannel) {
        self.channel = channel
    }

    func make(_ plan: CallbackPostPlan, queue: DispatchQueue) -> CallbackChannel {
        lock.lock()
        recordedPlans.append(plan)
        recordedThread = ObjectIdentifier(Thread.current)
        recordedQueue = queue
        lock.unlock()
        return channel
    }

    var plans: [CallbackPostPlan] {
        lock.lock()
        defer { lock.unlock() }
        return recordedPlans
    }

    var thread: ObjectIdentifier? {
        lock.lock()
        defer { lock.unlock() }
        return recordedThread
    }

    func used(_ queue: DispatchQueue) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return recordedQueue === queue
    }
}

final class CallbackPostBridgeTests: XCTestCase {
    private let href = "https://example.com/cb?x=1"
    private let address = "8.8.8.8"
    private let body = "{\"ok\":true}"

    func testAcceptedRequestResolvesStatusAndBuildsExpectedPlanOffCallingThread() {
        let callingThread = ObjectIdentifier(Thread.current)
        let channel = BridgeScriptedChannel(response: "HTTP/1.1 204 No Content\r\n\r\n")
        let factory = BridgeChannelFactory(channel)
        let queue = DispatchQueue(label: "CallbackPostBridgeTests.accepted")
        let result = invoke(options: validOptions(), factory: factory, queue: queue)
        let expected = CallbackPostPlan.make(
            href: href, address: address, body: body, timeoutMs: 10_000,
            redirect: "manual", credentials: "omit", developerMode: false
        )

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?.count, 1)
        XCTAssertEqual(result.data?["status"] as? Int, 204)
        XCTAssertEqual(factory.plans, [expected].compactMap { $0 })
        XCTAssertNotEqual(factory.thread, callingThread)
        XCTAssertTrue(factory.used(queue))
    }

    func testServerErrorStillResolvesItsStatus() {
        let channel = BridgeScriptedChannel(
            response: "HTTP/1.1 500 Internal Server Error\r\n\r\n"
        )
        let factory = BridgeChannelFactory(channel)
        let result = invoke(options: validOptions(), factory: factory)

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?.count, 1)
        XCTAssertEqual(result.data?["status"] as? Int, 500)
        XCTAssertEqual(factory.plans.count, 1)
    }

    func testRefusedRequestsRejectWithoutCreatingChannel() {
        var cases: [(String, [String: Any])] = []
        var redirect = validOptions()
        redirect["redirect"] = "follow"
        cases.append(("redirect", redirect))
        var credentials = validOptions()
        credentials["credentials"] = "include"
        cases.append(("credentials", credentials))
        var timeout = validOptions()
        timeout.removeValue(forKey: "timeoutMs")
        cases.append(("timeout", timeout))
        var loopback = validOptions()
        loopback["address"] = "127.0.0.1"
        cases.append(("loopback", loopback))

        for (name, options) in cases {
            let factory = BridgeChannelFactory(BridgeScriptedChannel())
            let result = invoke(options: options, factory: factory, label: name)

            XCTAssertNil(result.data, name)
            XCTAssertEqual(result.error, "Callback request refused", name)
            XCTAssertTrue(factory.plans.isEmpty, name)
        }
    }

    func testFailedChannelStartRejectsGenericMessage() {
        let factory = BridgeChannelFactory(BridgeScriptedChannel(startResult: false))
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
        factory: BridgeChannelFactory,
        queue: DispatchQueue? = nil,
        label: String = "post"
    ) -> (data: [String: Any]?, error: String?) {
        let workQueue = queue ?? DispatchQueue(label: "CallbackPostBridgeTests.\(label)")
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

        CallbackPostBridge.handle(call, channel: factory.make, queue: workQueue)

        wait(for: [done], timeout: 5)
        workQueue.sync {}
        XCTAssertEqual(settlements, 1, label)
        return (data, message)
    }
}
