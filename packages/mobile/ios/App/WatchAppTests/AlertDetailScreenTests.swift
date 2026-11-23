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

        let content = renderedContent(in: screen.body)
        let time = RelativeTimeText.fill(NSLocalizedString("w3.timeHours", comment: ""), n: 2)

        XCTAssertTrue(content.strings.contains(screen.familySymbol))
        XCTAssertTrue(content.strings.contains(
            "Payment alert needs review on your phone so it can continue."
        ))
        XCTAssertTrue(content.strings.contains(
            "This notice keeps complete payment context on your phone, where you can review the amount, source, timing, and next step safely before choosing what to do next."
        ))
        XCTAssertTrue(content.strings.contains(time))
        XCTAssertTrue(content.strings.contains("w4.openOnPhone"))
        XCTAssertTrue(content.strings.contains("iphone"))
        XCTAssertNotNil(render(screen, width: 176, height: 208))
    }

    func testBlankAlertBodyLeavesTitleAndTime() {
        let item = SnapshotInboxItem(
            id: "alert", family: "messages", kind: "incomingMessage",
            title: "A complete alert title", body: " \n ", at: now, read: false
        )
        let screen = AlertDetailScreen(item: item, now: now, onOpenOnPhone: {})

        let content = renderedContent(in: screen.body)
        let time = RelativeTimeText.fill(NSLocalizedString("w3.timeMinutes", comment: ""), n: 0)

        XCTAssertTrue(content.strings.contains("A complete alert title"))
        XCTAssertTrue(content.strings.contains(time))
        XCTAssertFalse(content.strings.contains(" \n "))
        XCTAssertNotNil(render(screen, width: 205, height: 251))
    }

    func testPendingRequestShowsAmountAndExpiry() throws {
        let request = try requestFixture("request-paydue")
        let screen = AlertDetailScreen(request: request, now: now, onOpenOnPhone: {})

        let content = renderedContent(in: screen.body)
        let expiry = Date(timeIntervalSince1970: 4_102_444_800)

        XCTAssertTrue(content.strings.contains(screen.familySymbol))
        XCTAssertTrue(content.strings.contains("Payment is due for this request."))
        XCTAssertTrue(content.strings.contains("w4.requestAmount"))
        XCTAssertTrue(content.strings.contains("125.00 USDC"))
        XCTAssertTrue(content.strings.contains("w4.requestExpiry"))
        XCTAssertTrue(content.dates.contains(expiry))
        XCTAssertTrue(content.strings.contains("w4.openOnPhone"))
        XCTAssertNotNil(render(screen, width: 176, height: 208))
    }

    func testExpiredRequestAndOpenOnPhoneAction() throws {
        var openCount = 0
        let screen = AlertDetailScreen(
            request: try requestFixture("request-expired"), now: now,
            onOpenOnPhone: { openCount += 1 }
        )

        let content = renderedContent(in: screen.body)

        XCTAssertTrue(content.strings.contains("w4.requestExpired"))
        XCTAssertFalse(content.strings.contains("w4.requestExpiry"))
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

    private func renderedContent(in value: Any) -> (strings: Set<String>, dates: Set<Date>) {
        var strings = Set<String>()
        var dates = Set<Date>()
        var visited = Set<ObjectIdentifier>()

        func visit(_ value: Any, depth: Int) {
            guard depth < 40 else { return }
            if let string = value as? String {
                strings.insert(string)
                return
            }
            if let date = value as? Date {
                dates.insert(date)
                return
            }

            let mirror = Mirror(reflecting: value)
            if mirror.displayStyle == .class {
                let identifier = ObjectIdentifier(value as AnyObject)
                guard visited.insert(identifier).inserted else { return }
            }
            for child in mirror.children {
                visit(child.value, depth: depth + 1)
            }
        }

        visit(value, depth: 0)
        return (strings, dates)
    }
}
