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
                let screen = BalancesScreen(
                    snapshot: snapshot,
                    mode: modeName == "fiat" ? .fiat : .units,
                    phoneReachable: true,
                    now: snapshot.builtAt,
                    setMode: { _ in },
                    open: { _ in }
                )
                XCTAssertEqual(
                    display.lines.indices.map(screen.rowLabel),
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
        let balancesScreen = BalancesScreen(
            snapshot: snapshot, mode: .fiat, phoneReachable: true,
            now: snapshot.builtAt, setMode: { _ in }, open: { _ in }
        )
        XCTAssertEqual(
            balancesScreen.headerLabel(),
            snapshot.totals.fiatText
        )
        XCTAssertNotNil(balances.header)
        for (control, expected) in [
            (BalancesToolbarRules.Control.bell, "Alerts"),
            (.qr, "Receive"),
            (.status, "Status"),
        ] {
            XCTAssertEqual(
                balancesScreen.toolbarContent.controlLabel(control),
                expected
            )
        }
        let requestModel = try XCTUnwrap(balancesScreen.requestModel)
        XCTAssertEqual(balancesScreen.requestLabel(requestModel), "1 request waiting")
        for key in balancesScreen.display.banners {
            XCTAssertEqual(balancesScreen.controlLabel(key), text(key))
        }
        if let age = balancesScreen.display.ageLine {
            XCTAssertEqual(balancesScreen.controlLabel(age), text(age))
        }

        let detail = TokenDetailPresenter.present(
            row: snapshot.rows[0], detail: nil, phoneReachable: false
        )
        let detailScreen = TokenDetailScreen(display: detail, onOpenOnPhone: {})
        XCTAssertEqual(detailScreen.identityLabel(), "Pepe Cash, PEPECASH")
        XCTAssertEqual(detailScreen.amountLabel(), "Pepe Cash, 1,000 PEPECASH")
        let priceSource = TokenDetailFactRow(
            label: "w2.priceSource", localized: true, value: "XChain DEX"
        )
        XCTAssertEqual(
            detailScreen.factLabel(priceSource),
            "Price source, XChain DEX"
        )
        XCTAssertEqual(detailScreen.controlLabel("w2.openOnPhone"), "Open on phone")
        let noticeKey = try XCTUnwrap(detailScreen.noticeKey)
        XCTAssertEqual(detailScreen.controlLabel(noticeKey), text(noticeKey))
        let hiddenDetail = TokenDetailPresenter.present(
            row: snapshot.rows[0], detail: nil, phoneReachable: false, redacted: true
        )
        XCTAssertEqual(
            TokenDetailScreen(display: hiddenDetail, onOpenOnPhone: {}).amountLabel(),
            "Pepe Cash, Amount hidden"
        )

        let alert = try JSONDecoder().decode(
            [SnapshotInboxItem].self,
            from: WatchFixtureFiles.data("inbox-alerts", in: directory)
        )[0]
        let alertsScreen = AlertsScreen(inbox: [alert], now: alert.at, markRead: { _ in })
        let alertLabel =
            "Send confirmed, Your send is confirmed and now appears in wallet activity., Just now"
        XCTAssertEqual(alertsScreen.rowLabel(alert), alertLabel)
        let alertDetail = AlertDetailScreen(item: alert, now: alert.at, onOpenOnPhone: {})
        XCTAssertEqual(alertDetail.alertLabel(alert), alertLabel)
        XCTAssertEqual(alertDetail.controlLabel("w4.openOnPhone"), "Open on phone")
        XCTAssertEqual(
            AlertsScreen(inbox: [], now: alert.at, markRead: { _ in }).controlLabel("w3.empty"),
            text("w3.empty")
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
            let screen = AlertDetailScreen(
                request: request, now: 1_700_000_000_000, onOpenOnPhone: {}
            )
            XCTAssertEqual(screen.requestLabel(0), expectedLines[0], name)
            XCTAssertEqual(screen.requestLabel(1), expectedLines[1], name)
            if name == "request-expired" {
                XCTAssertEqual(screen.requestLabel(2), expectedLines[2], name)
            } else if name == "request-paydue" {
                XCTAssertTrue(screen.requestLabel(2).hasPrefix("Expires, "), name)
            }
            XCTAssertEqual(screen.controlLabel("w4.openOnPhone"), "Open on phone", name)
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

        XCTAssertNotNil(WatchRender.image(
            w1, size: size, dynamicTypeSize: .accessibility3
        ))
        XCTAssertNotNil(WatchRender.image(
            w2, size: size, dynamicTypeSize: .accessibility3
        ))

        let rowWidth = size.width - CGFloat(BalanceRowRules.iconPoints + 8 + 32)
        let detailWidth = size.width - 32
        for row in w1.rows {
            let amount = w1.rowView(row).amountCell
            assertFits(
                amount.primary,
                font: .body,
                in: rowWidth,
                file: #filePath,
                line: #line
            )
            if let secondary = amount.secondary {
                assertFits(
                    secondary,
                    font: .caption2,
                    in: rowWidth,
                    file: #filePath,
                    line: #line
                )
            }
        }
        assertFits(
            w2.amountText,
            font: .title3,
            in: detailWidth,
            file: #filePath,
            line: #line
        )
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

    private func assertFits(
        _ text: String,
        font: Font,
        in width: CGFloat,
        file: StaticString,
        line: UInt
    ) {
        let measuredWidth = WatchRender.idealWidth(
            of: text,
            font: font,
            dynamicTypeSize: .accessibility3
        )
        XCTAssertLessThanOrEqual(
            (measuredWidth ?? .infinity) * 0.5,
            width,
            "Amount '\(text)' does not fit its rendered frame at minimum scale",
            file: file,
            line: line
        )
    }
}
