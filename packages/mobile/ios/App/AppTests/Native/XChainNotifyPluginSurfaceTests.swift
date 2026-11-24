// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import UserNotifications
import XCTest
@testable import App

private final class PluginNotifyScheduleCenter: NotifyScheduleCenter {
    var requests: [UNNotificationRequest] = []
    var cancelled: [[String]] = []

    func pending(_ completion: @escaping ([UNNotificationRequest]) -> Void) {
        completion(requests)
    }

    func add(_ request: UNNotificationRequest, completion: @escaping (Error?) -> Void) {
        requests.append(request)
        completion(nil)
    }

    func cancel(ids: [String]) {
        cancelled.append(ids)
        requests.removeAll { ids.contains($0.identifier) }
    }
}

final class XChainNotifyPluginSurfaceTests: XCTestCase {
    private let validPost: [String: Any] = [
        "id": "d-1",
        "title": "Deadline",
        "family": "deadlines",
    ]

    func testBridgeSurfaceMatchesNotifyContract() {
        let plugin = XChainNotifyPlugin()

        XCTAssertEqual(plugin.identifier, "XChainNotifyPlugin")
        XCTAssertEqual(plugin.jsName, "XChainNotify")
        XCTAssertEqual(
            plugin.pluginMethods.map(\.name),
            ["requestPermission", "permissionState", "post", "schedule", "cancel", "cancelAll"]
        )
        XCTAssertTrue(plugin.pluginMethods.allSatisfy { $0.returnType == CAPPluginReturnPromise })
    }

    func testScheduleAddsRequestAndResolvesTrue() throws {
        let center = PluginNotifyScheduleCenter()
        let plugin = XChainNotifyPlugin()
        plugin.scheduler = NotifySchedule(center: center)
        var options = validPost
        options["at"] = Date().addingTimeInterval(60).timeIntervalSince1970 * 1_000

        let result = call(plugin, method: "schedule", options: options)

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?["scheduled"] as? Bool, true)
        XCTAssertEqual(center.requests.map(\.identifier), ["d-1"])
    }

    func testCancelHandsIdToSchedulerAndResolvesTrue() {
        let center = PluginNotifyScheduleCenter()
        let plugin = XChainNotifyPlugin()
        plugin.scheduler = NotifySchedule(center: center)

        let result = call(plugin, method: "cancel", options: ["id": "d-1"])

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?["cancelled"] as? Bool, true)
        XCTAssertEqual(center.cancelled, [["d-1"]])
    }

    func testPostAndScheduleWithoutTitleRejectBeforeScheduling() {
        let center = PluginNotifyScheduleCenter()
        let plugin = XChainNotifyPlugin()
        plugin.scheduler = NotifySchedule(center: center)
        let invalidPost: [String: Any] = ["id": "d-1", "family": "deadlines"]
        var invalidSchedule = invalidPost
        invalidSchedule["at"] = Date().addingTimeInterval(60).timeIntervalSince1970 * 1_000

        let post = call(plugin, method: "post", options: invalidPost)
        let schedule = call(plugin, method: "schedule", options: invalidSchedule)

        XCTAssertEqual(post.error, "post arguments are invalid")
        XCTAssertEqual(schedule.error, "schedule arguments are invalid")
        XCTAssertTrue(center.requests.isEmpty)
        XCTAssertTrue(center.cancelled.isEmpty)
    }

    private func call(
        _ plugin: XChainNotifyPlugin,
        method: String,
        options: [String: Any] = [:]
    ) -> (data: [String: Any]?, error: String?) {
        let done = expectation(description: "\(method) settles")
        var data: [String: Any]?
        var message: String?
        let call = CAPPluginCall(
            callbackId: "test-\(method)",
            methodName: method,
            options: JSTypes.coerceDictionaryToJSObject(options) ?? [:],
            success: { result, _ in data = result?.data ?? [:]; done.fulfill() },
            error: { error in message = error?.message; done.fulfill() }
        )!
        switch method {
        case "post": plugin.post(call)
        case "schedule": plugin.schedule(call)
        default: plugin.cancel(call)
        }
        wait(for: [done], timeout: 5)
        return (data, message)
    }
}
