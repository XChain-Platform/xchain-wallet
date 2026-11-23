// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class RequestLongLookTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testRequestFixturesProduceTheirExpectedLongLookContent() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let names = WatchFixtureFiles.names(prefix: "request-", in: directory)

        XCTAssertEqual(names, ["request-confirm", "request-expired", "request-paydue"])

        let confirm = try request("request-confirm", in: directory)
        let confirmView = RequestLongLook(request: confirm, openOnPhone: {})
        let confirmContent = try XCTUnwrap(confirmView.presentation(at: Date(timeIntervalSince1970: 0)))
        XCTAssertEqual(confirmContent.titleKey, "n2.kind.request")
        XCTAssertEqual(confirmContent.sentence, "Confirm this Send request on your phone.")
        XCTAssertEqual(confirmContent.amountText, "0.025 BTC")
        XCTAssertNil(confirmContent.expiresInSeconds)

        let paydue = try request("request-paydue", in: directory)
        let paydueView = RequestLongLook(request: paydue, openOnPhone: {})
        let paydueContent = try XCTUnwrap(paydueView.presentation(at: Date(timeIntervalSince1970: 4_102_444_799)))
        XCTAssertEqual(paydueContent.titleKey, "n2.kind.paydue")
        XCTAssertEqual(paydueContent.sentence, "Payment is due for this request.")
        XCTAssertEqual(paydueContent.amountText, "125.00 USDC")
        XCTAssertEqual(paydueContent.expiresInSeconds, 1)

        let expired = try request("request-expired", in: directory)
        let expiredView = RequestLongLook(request: expired, openOnPhone: {})
        XCTAssertNil(expiredView.presentation(at: Date(timeIntervalSince1970: 946_684_800)))
    }

    @MainActor
    func testRenderedOpenOnPhoneButtonFiresForRequestAndPaydue() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())

        for name in ["request-confirm", "request-paydue"] {
            let fixture = try request(name, in: directory)
            var openedIds: [String] = []
            let view = RequestLongLook(request: fixture) {
                openedIds.append(fixture.id)
            }
            let content = try XCTUnwrap(view.presentation(at: Date(timeIntervalSince1970: 0)))
            let action = RequestLongLookOpenOnPhoneAction(
                titleKey: content.openOnPhoneKey,
                openOnPhone: view.openOnPhone
            )
            let button = action.body
            let buttonType = String(reflecting: type(of: button))
            XCTAssertTrue(buttonType.contains("SwiftUI.Button<"), buttonType)
            let installedAction = try XCTUnwrap(
                Mirror(reflecting: button).children.first { $0.label == "action" }?.value,
                "Rendered view has no button action for \(name)"
            )
            let trigger = try XCTUnwrap(
                Mirror(reflecting: installedAction).children
                    .first { $0.label == "closure" }?.value as? @MainActor () -> Void,
                "Rendered button has no trigger closure for \(name)"
            )

            trigger()

            XCTAssertEqual(openedIds, [fixture.id], name)
            XCTAssertEqual(content.openOnPhoneKey, "n2.openOnPhone", name)
        }
    }

    private func request(_ name: String, in directory: URL) throws -> Request {
        try decoder.decode(Request.self, from: WatchFixtureFiles.data(name, in: directory))
    }
}
