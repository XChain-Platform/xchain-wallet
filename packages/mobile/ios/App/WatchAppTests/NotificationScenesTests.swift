// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

@MainActor
final class NotificationScenesTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testRegistersEveryNotificationSceneWithTheExpectedLongLook() {
        let registrations = notificationRegistrations(in: XChainWatchApp().body)

        XCTAssertEqual(registrations, [
            "AlertNotificationController": ["alert"],
            "RequestNotificationController": ["paydue", "request"],
        ])
    }

    func testTapAndOpenOnPhoneRouteMatchingRequestsToAlertDetail() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        for (fixture, category) in [("request-confirm", "request"), ("request-paydue", "paydue")] {
            let request = try decoder.decode(
                Request.self,
                from: WatchFixtureFiles.data(fixture, in: directory)
            )
            for actionId in [
                NotificationSceneRules.defaultActionId,
                NotificationSceneRules.openOnPhoneActionId,
            ] {
                let delegate = WatchApplicationDelegate(pendingRequest: { request })

                XCTAssertTrue(delegate.route(
                    notificationId: request.id,
                    category: category,
                    actionId: actionId
                ))
                XCTAssertEqual(delegate.request?.id, request.id, "\(fixture) \(actionId)")
            }
        }
    }

    func testRefusesDismissedAndStaleRequestRoutes() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let request = try decoder.decode(
            Request.self,
            from: WatchFixtureFiles.data("request-confirm", in: directory)
        )
        let delegate = WatchApplicationDelegate(pendingRequest: { request })

        XCTAssertFalse(delegate.route(
            notificationId: request.id,
            category: "request",
            actionId: NotificationSceneRules.dismissActionId
        ))
        XCTAssertFalse(delegate.route(
            notificationId: "stale-request",
            category: "request",
            actionId: NotificationSceneRules.defaultActionId
        ))
        XCTAssertNil(delegate.request)
    }

    func testDelegatePublishesOnlyMatchingPendingRequests() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let request = try decoder.decode(
            Request.self,
            from: WatchFixtureFiles.data("request-confirm", in: directory)
        )
        let delegate = WatchApplicationDelegate(pendingRequest: { request })

        XCTAssertFalse(delegate.route(
            notificationId: "request-id",
            category: "alert",
            actionId: NotificationSceneRules.defaultActionId
        ))
        XCTAssertNil(delegate.request)
        XCTAssertTrue(delegate.route(
            notificationId: request.id,
            category: "request",
            actionId: NotificationSceneRules.defaultActionId
        ))
        XCTAssertEqual(delegate.request?.id, request.id)
        delegate.dismissRequest()
        XCTAssertNil(delegate.request)
    }

    private func notificationRegistrations(in root: Any) -> [String: [String]] {
        var registrations: [String: [String]] = [:]

        func visit(_ value: Any) {
            let type = String(describing: Swift.type(of: value))
            if type.hasPrefix("WKNotificationScene<") {
                let controller = ["AlertNotificationController", "RequestNotificationController"]
                    .first(where: type.contains)
                if let controller {
                    registrations[controller, default: []].append(contentsOf: strings(in: value))
                }
                return
            }
            for child in Mirror(reflecting: value).children {
                visit(child.value)
            }
        }

        visit(root)
        return registrations.mapValues { $0.sorted() }
    }

    private func strings(in root: Any) -> [String] {
        if let value = root as? String { return [value] }
        return Mirror(reflecting: root).children.flatMap { strings(in: $0.value) }
    }
}
