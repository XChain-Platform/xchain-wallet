// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import XCTest
@testable import App

final class SceneDelegateHandoffTests: XCTestCase {
    func testWatchActivityDeliversRouteAsXChainURL() {
        let activity = NSUserActivity(activityType: WatchViewActivity.activityType)
        activity.userInfo = [WatchViewActivity.routeKey: "/review/request-1"]
        var delivered: String?

        let handled = SceneDelegate().deliverWatchHandoff(activity) { delivered = $0 }

        XCTAssertTrue(handled)
        XCTAssertEqual(delivered, "xchain:/review/request-1")
    }

    func testUnrelatedActivityIsNotHandled() {
        let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
        activity.userInfo = ["route": "/review/request-1"]
        var deliveries = 0

        let handled = SceneDelegate().deliverWatchHandoff(activity) { _ in deliveries += 1 }

        XCTAssertFalse(handled)
        XCTAssertEqual(deliveries, 0)
    }

    func testMalformedWatchActivityIsNotHandled() {
        let activity = NSUserActivity(activityType: WatchViewActivity.activityType)
        activity.userInfo = [
            WatchViewActivity.routeKey: "/review/request-1",
            "unexpected": true,
        ]
        var deliveries = 0

        let handled = SceneDelegate().deliverWatchHandoff(activity) { _ in deliveries += 1 }

        XCTAssertFalse(handled)
        XCTAssertEqual(deliveries, 0)
    }
}
