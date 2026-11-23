// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class AlertLongLookTests: XCTestCase {
    private let now: Int64 = 1_700_000_000_000

    func testRendersInboxAlertWithKindFamilyAndTime() throws {
        let item = try XCTUnwrap(alerts().first)
        let view = AlertLongLook(item: item, now: now, alwaysOn: false)

        XCTAssertEqual(view.kindKey, "n1.kind.txConfirmed")
        XCTAssertEqual(view.familySymbol, "paperplane")
        XCTAssertEqual(view.relativeTime.key, "w3.timeJustNow")
        XCTAssertEqual(view.relativeTime.n, 0)
        XCTAssertTrue(view.showsDetails)
        XCTAssertNotNil(render(view))
    }

    func testAlwaysOnRendersKindLabelWithoutAlertDetails() throws {
        let item = try XCTUnwrap(alerts().first)
        let view = AlertLongLook(item: item, now: now, alwaysOn: true)

        XCTAssertEqual(view.kindKey, "n1.kind.txConfirmed")
        XCTAssertFalse(view.showsDetails)
        XCTAssertNotNil(render(view))
    }

    func testEveryFixtureKindHasAContractLabelAndRenders() throws {
        for item in try alerts() {
            XCTAssertNotNil(AlertKindLabel.key(kind: item.kind), item.kind)
            XCTAssertFalse(AlertFamilyIcon.symbol(family: item.family).isEmpty, item.family)
        }

        let item = try XCTUnwrap(alerts().last)
        XCTAssertNotNil(render(AlertLongLook(item: item, now: now, alwaysOn: false)))
    }

    private func alerts() throws -> [SnapshotInboxItem] {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let data = try WatchFixtureFiles.data("inbox-alerts", in: directory)
        return try JSONDecoder().decode([SnapshotInboxItem].self, from: data)
    }

    private func render(_ view: AlertLongLook) -> CGImage? {
        let renderer = ImageRenderer(content: view.frame(width: 184, height: 224))
        renderer.scale = 2
        return renderer.cgImage
    }
}
