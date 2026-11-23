// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

private final class RecordingUserActivity: NSUserActivity {
    private(set) var didBecomeCurrent = false

    override func becomeCurrent() {
        didBecomeCurrent = true
    }
}

final class OpenOnPhoneTests: XCTestCase {
    func testAdvertisesViewActivityWithRoute() throws {
        let intent = OpenOnPhoneIntent(route: "/asset/xcp")

        let activity = try XCTUnwrap(OpenOnPhone.userActivity(for: intent))

        XCTAssertEqual(activity.activityType, "io.xchain.wallet.view")
        XCTAssertEqual(activity.userInfo?["route"] as? String, intent.route)
    }

    func testSendsOpenOnPhoneIntent() throws {
        let intent = OpenOnPhoneIntent(route: "/request/123")
        let activity = RecordingUserActivity(activityType: ViewActivity.activityType)
        var sent: [[String: Any]] = []
        let openOnPhone = OpenOnPhone(
            send: { sent.append($0) },
            makeActivity: { _ in activity }
        )

        openOnPhone(intent)

        XCTAssertTrue(activity.didBecomeCurrent)
        let message = try XCTUnwrap(sent.first)
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(message["kind"] as? String, "openOnPhone")
        let value = try XCTUnwrap(message["value"] as? [String: Any])
        XCTAssertEqual(value["route"] as? String, intent.route)
    }

    func testEmptyRouteNeitherAdvertisesNorSends() {
        let intent = OpenOnPhoneIntent(route: "")
        var sent: [[String: Any]] = []
        let openOnPhone = OpenOnPhone { sent.append($0) }

        openOnPhone(intent)

        XCTAssertNil(OpenOnPhone.userActivity(for: intent))
        XCTAssertTrue(sent.isEmpty)
    }
}
