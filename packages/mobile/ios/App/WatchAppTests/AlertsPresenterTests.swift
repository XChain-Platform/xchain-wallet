// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class AlertsPresenterTests: XCTestCase {
    func testEveryRequestFixtureMatchesSharedExpectedModel() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let expectedData = try WatchFixtureFiles.data("expected/request", in: directory)
        let expected = try XCTUnwrap(
            JSONSerialization.jsonObject(with: expectedData) as? [String: Any]
        )
        let now = try XCTUnwrap((expected["now"] as? NSNumber)?.int64Value)
        let names = WatchFixtureFiles.names(prefix: "request-", in: directory)

        XCTAssertEqual(
            Set(expected.keys).subtracting(["now"]),
            Set(names)
        )

        for name in names {
            let request = try JSONDecoder().decode(
                Request.self,
                from: WatchFixtureFiles.data(name, in: directory)
            )
            let model = AlertsPresenter.request(request, now: now)
            let actual = try JSONSerialization.jsonObject(
                with: JSONEncoder().encode(model)
            ) as? NSDictionary
            let wanted = expected[name] as? NSDictionary

            XCTAssertEqual(actual, wanted, name)
        }
    }

    func testInboxIsNewestFirstAndLimited() {
        let items = (0..<25).map { index in
            SnapshotInboxItem(
                id: "alert-\(index)",
                family: "payment",
                kind: "received",
                title: "Alert \(index)",
                body: "Body",
                at: Int64(index),
                read: index.isMultiple(of: 2)
            )
        }

        let rows = AlertsPresenter.inbox(items)

        XCTAssertEqual(rows.count, 20)
        XCTAssertEqual(rows.first?.id, "alert-24")
        XCTAssertEqual(rows.last?.id, "alert-5")
    }

    func testDetailOmitsBlankBody() {
        let item = SnapshotInboxItem(
            id: "alert",
            family: "payment",
            kind: "received",
            title: "Alert",
            body: " \n ",
            at: 1,
            read: false
        )

        XCTAssertNil(AlertsPresenter.detailBody(item))
    }
}
