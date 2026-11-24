// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class AccessibilityTests: XCTestCase {
    private struct ExpectedMode: Decodable {
        let a11y: [String]?
    }

    private struct ExpectedFixture: Decodable {
        let fiat: ExpectedMode
        let units: ExpectedMode
    }

    func testEveryBalanceFixtureHasItsExpectedSpokenLabels() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let expected = try JSONDecoder().decode(
            [String: ExpectedFixture].self,
            from: WatchFixtureFiles.data("expected/balances", in: directory)
        )
        let strings = try contractStrings(directory: directory)

        for (fixture, expectedFixture) in expected {
            let snapshot = try JSONDecoder().decode(
                Snapshot.self,
                from: WatchFixtureFiles.data(fixture, in: directory)
            )
            for (modeName, expectedMode) in [
                ("fiat", expectedFixture.fiat), ("units", expectedFixture.units),
            ] {
                let display = BalancesPresenter.present(
                    snapshot: snapshot,
                    mode: modeName == "fiat" ? .fiat : .units,
                    now: snapshot.builtAt
                )
                XCTAssertEqual(
                    AccessibilityLabels.balanceLines(display) { strings[$0] ?? $0 },
                    expectedMode.a11y ?? [],
                    "\(fixture) \(modeName)"
                )
            }
        }
    }

    func testW1ThroughW4LabelsCoverEveryRowAndControl() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let strings = try contractStrings(directory: directory)
        let text: (String) -> String = { strings[$0] ?? $0 }
        let snapshot = try snapshot("snapshot-unpriced", directory: directory)
        let balances = BalancesPresenter.present(snapshot: snapshot, mode: .fiat)
        XCTAssertEqual(
            AccessibilityLabels.balanceHeader(balances, text: text),
            snapshot.totals.fiatText
        )
        for (key, expected) in [
            ("w3.title", "Alerts"),
            ("w1.receive", "Receive"),
            ("state.status", "Status"),
            ("w2.openOnPhone", "Open on phone"),
            ("w4.openOnPhone", "Open on phone"),
        ] {
            XCTAssertEqual(AccessibilityLabels.control(key, text: text), expected)
        }

        let detail = TokenDetailPresenter.present(
            row: snapshot.rows[0], detail: nil, phoneReachable: false
        )
        XCTAssertEqual(AccessibilityLabels.tokenIdentity(detail), "Pepe Cash, PEPECASH")
        XCTAssertEqual(
            AccessibilityLabels.tokenAmount(detail, showsValue: false, text: text),
            "Pepe Cash, 1,000 PEPECASH"
        )
        XCTAssertEqual(
            AccessibilityLabels.labeled(
                "w2.priceSource", value: "XChain DEX", localized: true, text: text
            ),
            "Price source, XChain DEX"
        )
        let hiddenDetail = TokenDetailPresenter.present(
            row: snapshot.rows[0], detail: nil, phoneReachable: false, redacted: true
        )
        XCTAssertEqual(
            AccessibilityLabels.tokenAmount(hiddenDetail, showsValue: false, text: text),
            "Pepe Cash, Amount hidden"
        )

        let alert = try JSONDecoder().decode(
            [SnapshotInboxItem].self,
            from: WatchFixtureFiles.data("inbox-alerts", in: directory)
        )[0]
        XCTAssertEqual(
            AccessibilityLabels.alertRow(alert, time: "Just now"),
            "Send confirmed, Your send is confirmed and now appears in wallet activity., Just now"
        )
        XCTAssertEqual(
            AccessibilityLabels.alertDetail(alert, time: "Just now"),
            "Send confirmed, Your send is confirmed and now appears in wallet activity., Just now"
        )

        let requests = [
            ("request-confirm", [
                "Request, Confirm this Send request on your phone.", "Amount, 0.025 BTC",
            ]),
            ("request-expired", [
                "Request, This payment request has expired.", "Amount, 48.50 USDC",
                "This request expired.",
            ]),
            ("request-paydue", [
                "Request, Payment is due for this request.", "Amount, 125.00 USDC",
                "Expires, at:4102444800000",
            ]),
        ]
        for (name, expectedLines) in requests {
            let request = try JSONDecoder().decode(
                Request.self,
                from: WatchFixtureFiles.data(name, in: directory)
            )
            let model = AlertsPresenter.request(request, now: 1_700_000_000_000)
            XCTAssertEqual(AccessibilityLabels.requestPinned(model, text: text), "1 request waiting")
            XCTAssertEqual(
                AccessibilityLabels.requestLines(model, text: text) { "at:\($0)" },
                expectedLines,
                name
            )
        }
    }

    func testW1AndW2RenderAtAccessibility3WithoutTruncatedAmount() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let snapshot = try snapshot("snapshot-testnet", directory: directory)
        let size = WatchRender.screenSize()
        let w1 = BalancesScreen(
            snapshot: snapshot, mode: .units, phoneReachable: true, now: snapshot.builtAt,
            setMode: { _ in }, open: { _ in }
        )
        let w2 = TokenDetailScreen(
            display: TokenDetailPresenter.present(
                row: snapshot.rows[0], detail: nil, phoneReachable: false
            ),
            onOpenOnPhone: {}
        )

        XCTAssertNotNil(WatchRender.image(w1, size: size, dynamicTypeSize: .accessibility3))
        XCTAssertNotNil(WatchRender.image(w2, size: size, dynamicTypeSize: .accessibility3))
        for font in [Font.body, Font.title3] {
            XCTAssertTrue(WatchRender.fits(
                snapshot.rows[0].amountText,
                font: font,
                dynamicTypeSize: .accessibility3,
                width: size.width
            ))
        }
    }

    private func snapshot(_ name: String, directory: URL) throws -> Snapshot {
        try JSONDecoder().decode(
            Snapshot.self,
            from: WatchFixtureFiles.data(name, in: directory)
        )
    }

    private func contractStrings(directory: URL) throws -> [String: String] {
        let root = directory.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
        let contract = root.appendingPathComponent("packages/core/src/watch/contract")
        var strings: [String: String] = [:]
        for name in ["strings-balances", "strings-alerts"] {
            let data = try Data(contentsOf: contract.appendingPathComponent("\(name).json"))
            strings.merge(try JSONDecoder().decode([String: String].self, from: data)) { _, new in new }
        }
        return strings
    }
}
