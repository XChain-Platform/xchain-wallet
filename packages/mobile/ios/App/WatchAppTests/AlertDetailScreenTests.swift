// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class AlertDetailScreenTests: XCTestCase {
    private let now: Int64 = 1_700_000_000_000

    func testAlertShowsFullContractContent() throws {
        let item = try alerts()[2]
        let screen = AlertDetailScreen(item: item, now: now, onOpenOnPhone: {})

        XCTAssertEqual(screen.familySymbol, AlertFamilyIcon.symbol(family: item.family))
        XCTAssertEqual(screen.item?.title, "Payment alert needs review on your phone so it can continue.")
        XCTAssertEqual(
            screen.detailBody,
            "This notice keeps complete payment context on your phone, where you can review the amount, source, timing, and next step safely before choosing what to do next."
        )
        XCTAssertEqual(screen.alertTime?.key, "w3.timeHours")
        XCTAssertEqual(screen.alertTime?.n, 2)
        XCTAssertNil(screen.request)
        XCTAssertNotNil(render(screen, width: 176, height: 208))
    }

    func testBlankAlertBodyLeavesTitleAndTime() {
        let item = SnapshotInboxItem(
            id: "alert", family: "messages", kind: "incomingMessage",
            title: "A complete alert title", body: " \n ", at: now, read: false
        )
        let screen = AlertDetailScreen(item: item, now: now, onOpenOnPhone: {})

        XCTAssertNil(screen.detailBody)
        XCTAssertNotNil(render(screen, width: 205, height: 251))
    }

    func testPendingRequestShowsAmountAndExpiry() throws {
        let request = try requestFixture("request-paydue")
        let screen = AlertDetailScreen(request: request, now: now, onOpenOnPhone: {})

        XCTAssertEqual(screen.familySymbol, AlertFamilyIcon.symbol(family: request.kind.rawValue))
        XCTAssertFalse(screen.requestExpired)
        XCTAssertEqual(screen.request?.sentence, "Payment is due for this request.")
        XCTAssertEqual(screen.request?.amountText, "125.00 USDC")
        XCTAssertEqual(screen.request?.expiresAt, 4_102_444_800_000)
        XCTAssertNotNil(render(screen, width: 176, height: 208))
    }

    func testExpiredRequestAndOpenOnPhoneAction() throws {
        var openCount = 0
        let screen = AlertDetailScreen(
            request: try requestFixture("request-expired"), now: now,
            onOpenOnPhone: { openCount += 1 }
        )

        XCTAssertTrue(screen.requestExpired)
        screen.onOpenOnPhone()
        XCTAssertEqual(openCount, 1)
        XCTAssertNotNil(render(screen, width: 205, height: 251))
    }

    private func alerts() throws -> [SnapshotInboxItem] {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        return try JSONDecoder().decode(
            [SnapshotInboxItem].self,
            from: WatchFixtureFiles.data("inbox-alerts", in: directory)
        )
    }

    private func requestFixture(_ name: String) throws -> Request {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        return try JSONDecoder().decode(
            Request.self,
            from: WatchFixtureFiles.data(name, in: directory)
        )
    }

    private func render(_ view: AlertDetailScreen, width: CGFloat, height: CGFloat) -> CGImage? {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        renderer.scale = 2
        return renderer.cgImage
    }
}
