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
                var installed: [String] = []
                for row in screen.rows {
                    installed.append(try accessibilityLabel(in: screen.rowLink(row)))
                }
                for index in screen.rows.count ..< display.lines.count {
                    if let key = display.lines[index].key {
                        installed.append(try accessibilityLabel(
                            in: screen.statusLine(key, index: index)
                        ))
                    }
                }
                XCTAssertEqual(
                    installed,
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
            try accessibilityLabel(in: BalancesScreen(
                snapshot: snapshot, mode: .fiat, phoneReachable: true,
                now: snapshot.builtAt, setMode: { _ in }, open: { _ in }
            ).headerButton(try XCTUnwrap(balances.header))),
            snapshot.totals.fiatText
        )
        let balancesScreen = BalancesScreen(
            snapshot: snapshot, mode: .fiat, phoneReachable: true,
            now: snapshot.builtAt, setMode: { _ in }, open: { _ in }
        )
        for (control, expected) in [
            (BalancesToolbarRules.Control.bell, "Alerts"),
            (.qr, "Receive"),
            (.status, "Status"),
        ] {
            XCTAssertEqual(
                try accessibilityLabel(in: balancesScreen.toolbarContent.controlButton(control)),
                expected
            )
        }
        let requestModel = try XCTUnwrap(balancesScreen.requestModel)
        XCTAssertEqual(
            try accessibilityLabel(in: balancesScreen.requestLink(requestModel)),
            "1 request waiting"
        )
        for key in balancesScreen.display.banners {
            XCTAssertEqual(
                try accessibilityLabel(in: balancesScreen.banner(key)),
                text(key)
            )
        }
        if let age = balancesScreen.display.ageLine {
            XCTAssertEqual(
                try accessibilityLabel(in: balancesScreen.ageLine(age)),
                text(age)
            )
        }

        let detail = TokenDetailPresenter.present(
            row: snapshot.rows[0], detail: nil, phoneReachable: false
        )
        let detailScreen = TokenDetailScreen(display: detail, onOpenOnPhone: {})
        XCTAssertEqual(
            try accessibilityLabel(in: detailScreen.artworkButton),
            "Pepe Cash, PEPECASH"
        )
        XCTAssertEqual(
            try accessibilityLabel(in: detailScreen.amountButton),
            "Pepe Cash, 1,000 PEPECASH"
        )
        XCTAssertEqual(
            try accessibilityLabel(in: detailScreen.factRow(TokenDetailFactRow(
                label: "w2.priceSource", localized: true, value: "XChain DEX"
            ))),
            "Price source, XChain DEX"
        )
        XCTAssertEqual(
            try accessibilityLabel(in: detailScreen.openOnPhoneButton),
            "Open on phone"
        )
        let noticeKey = try XCTUnwrap(detailScreen.noticeKey)
        XCTAssertEqual(
            try accessibilityLabel(in: detailScreen.notice(noticeKey)),
            text(noticeKey)
        )
        let hiddenDetail = TokenDetailPresenter.present(
            row: snapshot.rows[0], detail: nil, phoneReachable: false, redacted: true
        )
        XCTAssertEqual(
            try accessibilityLabel(in: TokenDetailScreen(
                display: hiddenDetail, onOpenOnPhone: {}
            ).amountButton),
            "Pepe Cash, Amount hidden"
        )

        let alert = try JSONDecoder().decode(
            [SnapshotInboxItem].self,
            from: WatchFixtureFiles.data("inbox-alerts", in: directory)
        )[0]
        let alertsScreen = AlertsScreen(inbox: [alert], now: alert.at, markRead: { _ in })
        XCTAssertEqual(
            try accessibilityLabel(in: alertsScreen.rowLink(alert)),
            "Send confirmed, Your send is confirmed and now appears in wallet activity., Just now"
        )
        XCTAssertEqual(
            accessibilityLabels(in: AlertDetailScreen(
                item: alert, now: alert.at, onOpenOnPhone: {}
            ).body),
            [
                "Send confirmed, Your send is confirmed and now appears in wallet activity., Just now",
                "Open on phone",
            ]
        )
        XCTAssertEqual(
            try accessibilityLabel(in: AlertsScreen(
                inbox: [], now: alert.at, markRead: { _ in }
            ).emptyState),
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
            XCTAssertEqual(
                accessibilityLabels(in: screen.body),
                Set(screen.requestAccessibilityLines + ["Open on phone"]),
                name
            )
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

        let w1Image = try XCTUnwrap(WatchRender.image(
            w1, size: size, dynamicTypeSize: .accessibility3
        ))
        let w2Image = try XCTUnwrap(WatchRender.image(
            w2, size: size, dynamicTypeSize: .accessibility3
        ))
        XCTAssertFalse(WatchRender.isBlank(w1Image))
        XCTAssertFalse(WatchRender.isBlank(w2Image))

        let row = try XCTUnwrap(w1.rows.first)
        let renderedRow = w1.rowView(row).body.body
        XCTAssertTrue(WatchRender.strings(in: renderedRow).contains(snapshot.rows[0].amountText))
        XCTAssertTrue(environmentValues(Int.self, in: renderedRow).contains(1))
        let rowScale = try XCTUnwrap(
            environmentValues(CGFloat.self, in: w1.rowLink(row)).first { $0 == 0.5 }
        )
        XCTAssertTrue(WatchRender.strings(in: w2.amountButton).contains(snapshot.rows[0].amountText))
        let detailScale = try XCTUnwrap(
            environmentValues(CGFloat.self, in: w2.amountButton).first { $0 == 0.5 }
        )
        XCTAssertTrue(environmentValues(Int.self, in: w2.amountButton).contains(1))

        let rowWidth = size.width - CGFloat(BalanceRowRules.iconPoints + 8 + 32)
        let detailWidth = size.width - 32
        XCTAssertTrue(WatchRender.fits(
            snapshot.rows[0].amountText,
            font: .body,
            dynamicTypeSize: .accessibility3,
            width: rowWidth / rowScale
        ))
        XCTAssertTrue(WatchRender.fits(
            snapshot.rows[0].amountText,
            font: .title3,
            dynamicTypeSize: .accessibility3,
            width: detailWidth / detailScale
        ))
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

    private func accessibilityLabel(in value: Any) throws -> String {
        let labels = accessibilityLabels(in: value)
        XCTAssertEqual(labels.count, 1, "Rendered control must have exactly one accessibility label")
        return try XCTUnwrap(labels.first, "Rendered control has no accessibility label")
    }

    private func accessibilityLabels(in value: Any) -> Set<String> {
        var labels = Set<String>()

        func visit(_ value: Any, depth: Int) {
            guard depth < 60 else { return }
            if String(reflecting: type(of: value)) == "SwiftUI.AccessibilityAttachmentModifier" {
                labels.formUnion(WatchRender.strings(in: value))
                return
            }
            for child in Mirror(reflecting: value).children {
                visit(child.value, depth: depth + 1)
            }
        }

        visit(value, depth: 0)
        return labels
    }

    private func environmentValues<T>(_ type: T.Type, in value: Any) -> [T] {
        var values: [T] = []

        func visit(_ value: Any, depth: Int) {
            guard depth < 60 else { return }
            let mirror = Mirror(reflecting: value)
            if String(reflecting: Swift.type(of: value)).contains("EnvironmentKeyWritingModifier") {
                values += mirror.children.compactMap { child in
                    child.label == "value" ? child.value as? T : nil
                }
                values += mirror.children
                    .filter { $0.label == "value" }
                    .flatMap { Mirror(reflecting: $0.value).children }
                    .compactMap { $0.value as? T }
            }
            for child in mirror.children {
                visit(child.value, depth: depth + 1)
            }
        }

        visit(value, depth: 0)
        return values
    }
}
