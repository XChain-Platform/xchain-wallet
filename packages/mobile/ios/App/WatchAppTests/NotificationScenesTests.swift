// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

@MainActor
final class NotificationScenesTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testRegistersEveryNotificationSceneWithTheExpectedLongLook() throws {
        let sourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("WatchApp/XChainWatchApp.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)

        XCTAssertTrue(source.contains(
            "WKNotificationScene(controller: AlertNotificationController.self, category: \"alert\")"
        ))
        for category in ["request", "paydue"] {
            XCTAssertTrue(source.contains(
                "WKNotificationScene(controller: RequestNotificationController.self, category: \"\(category)\")"
            ))
        }
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
                let response = WatchNotificationResponse(
                    notificationId: request.id,
                    category: category,
                    actionId: actionId
                )

                XCTAssertEqual(
                    NotificationRoutingRootView.path(for: response, pendingRequest: request),
                    [.balances, .alertDetail],
                    "\(fixture) \(actionId)"
                )
            }
        }
    }

    func testRefusesDismissedAndStaleRequestRoutes() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let request = try decoder.decode(
            Request.self,
            from: WatchFixtureFiles.data("request-confirm", in: directory)
        )
        let dismissed = WatchNotificationResponse(
            notificationId: request.id,
            category: "request",
            actionId: NotificationSceneRules.dismissActionId
        )
        let stale = WatchNotificationResponse(
            notificationId: "stale-request",
            category: "request",
            actionId: NotificationSceneRules.defaultActionId
        )

        XCTAssertNil(NotificationRoutingRootView.path(for: dismissed, pendingRequest: request))
        XCTAssertEqual(
            NotificationRoutingRootView.path(for: stale, pendingRequest: request),
            [.balances]
        )
    }

    func testDelegatePublishesOnlyRoutableResponses() {
        let delegate = WatchApplicationDelegate()

        XCTAssertFalse(delegate.route(
            notificationId: "request-id",
            category: "request",
            actionId: NotificationSceneRules.dismissActionId
        ))
        XCTAssertNil(delegate.response)
        XCTAssertTrue(delegate.route(
            notificationId: "request-id",
            category: "request",
            actionId: NotificationSceneRules.defaultActionId
        ))
        XCTAssertEqual(delegate.response, WatchNotificationResponse(
            notificationId: "request-id",
            category: "request",
            actionId: NotificationSceneRules.defaultActionId
        ))
    }
}
