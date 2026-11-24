// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class AlertsScreenTests: XCTestCase {
    func testRowsAreNewestFirstAndLimitedToTwenty() {
        let screen = AlertsScreen(inbox: (0..<25).map(item), now: 25, markRead: { _ in })

        XCTAssertEqual(screen.rows.map(\.id), (5..<25).reversed().map { "alert-\($0)" })
    }

    func testRenderedRowInteractionMarksItsIdentifierRead() {
        var recorded: MarkReadIntent?
        let alert = item(7)
        let screen = AlertsScreen(inbox: [alert], now: 10, markRead: { recorded = $0 })

        XCTAssertTrue(invokeEndedAction(in: screen.rowLink(alert)))

        XCTAssertEqual(recorded?.id, "alert-7")
    }

    func testSelectionCarriesTheOpenedAlertIdentifier() {
        XCTAssertEqual(AlertSelection(id: "alert-3").id, "alert-3")
    }

    func testEmptyInboxHasNoRows() {
        let screen = AlertsScreen(inbox: [], now: 0, markRead: { _ in })

        XCTAssertTrue(screen.rows.isEmpty)
    }

    private func invokeEndedAction(in value: Any) -> Bool {
        for child in Mirror(reflecting: value).children {
            if child.label == "ended", let action = child.value as? ((()) -> Void) {
                action(())
                return true
            }
            if invokeEndedAction(in: child.value) {
                return true
            }
        }
        return false
    }

    private func item(_ index: Int) -> SnapshotInboxItem {
        SnapshotInboxItem(
            id: "alert-\(index)",
            family: index.isMultiple(of: 2) ? "messages" : "request",
            kind: "received",
            title: "Alert \(index)",
            body: "Body \(index)",
            at: Int64(index),
            read: index.isMultiple(of: 2)
        )
    }
}
