// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import UserNotifications
import XCTest
@testable import App

private final class PluginScheduleCenter: NotifyScheduleCenter {
    var requests: [UNNotificationRequest] = []

    func pending(_ completion: @escaping ([UNNotificationRequest]) -> Void) {
        completion(requests)
    }

    func add(_ request: UNNotificationRequest, completion: @escaping (Error?) -> Void) {
        requests.append(request)
        completion(nil)
    }

    func cancel(ids: [String]) {
        requests.removeAll { ids.contains($0.identifier) }
    }
}

final class XChainNotifyPluginTests: XCTestCase {
    func testDeclaresEveryNotifyMethodAsPromise() {
        let plugin = XChainNotifyPlugin()

        XCTAssertEqual(plugin.identifier, "XChainNotifyPlugin")
        XCTAssertEqual(plugin.jsName, "XChainNotify")
        XCTAssertEqual(
            plugin.pluginMethods.map(\.name),
            ["requestPermission", "permissionState", "post", "schedule", "cancel", "cancelAll"]
        )
        XCTAssertTrue(plugin.pluginMethods.allSatisfy { $0.returnType == CAPPluginReturnPromise })
    }

    func testLoadRegistersNotifyActionsCategories() {
        let center = UNUserNotificationCenter.current()
        let plugin = XChainNotifyPlugin()

        plugin.load()

        XCTAssertTrue(center.delegate is NotifyActions)
        let registered = expectation(description: "notification categories registered")
        center.getNotificationCategories { categories in
            XCTAssertEqual(
                Set(categories.map(\.identifier)),
                Set(["request", "paydue", "alert"])
            )
            registered.fulfill()
        }
        wait(for: [registered], timeout: 5)
    }

    func testScheduleDelegatesToNotifySchedule() {
        let center = PluginScheduleCenter()
        let plugin = XChainNotifyPlugin()
        plugin.scheduler = NotifySchedule(center: center)
        let settled = expectation(description: "schedule settles")
        var reply: [String: Any]?
        let call = CAPPluginCall(
            callbackId: "schedule-test",
            methodName: "schedule",
            options: JSTypes.coerceDictionaryToJSObject([
                "id": "deadline-1",
                "title": "Deadline",
                "body": "Review now",
                "family": "deadlines",
                "at": Date().addingTimeInterval(60).timeIntervalSince1970 * 1_000,
                "sound": "none",
                "category": "alert",
                "threadId": "deadlines",
            ]) ?? [:],
            success: { result, _ in
                reply = result?.data
                settled.fulfill()
            },
            error: { error in
                XCTFail(error?.message ?? "schedule rejected")
                settled.fulfill()
            }
        )!

        plugin.schedule(call)

        wait(for: [settled], timeout: 5)
        XCTAssertEqual(reply?["scheduled"] as? Bool, true)
        XCTAssertEqual(center.requests.map(\.identifier), ["deadline-1"])
        XCTAssertEqual(center.requests.first?.content.title, "Deadline")
        XCTAssertEqual(center.requests.first?.content.body, "Review now")
        XCTAssertEqual(center.requests.first?.content.categoryIdentifier, "alert")
        XCTAssertEqual(center.requests.first?.content.threadIdentifier, "deadlines")
        XCTAssertNil(center.requests.first?.content.sound)
    }
}
