// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class BalancesScreenTests: XCTestCase {
    func testRenderedBodyContainsCrownHeaderToolbarAndRowNavigation() {
        let screen = make(inbox: [item("alert", read: false)])
        let content = renderedContent(in: screen.body)

        XCTAssertTrue(content.typeNames.contains { $0.contains("DigitalCrown") })
        XCTAssertTrue(content.typeNames.contains { $0.contains("BalancesHeaderButton") })
        XCTAssertTrue(content.typeNames.contains { $0.contains("NavigationLink") })
        XCTAssertTrue(content.typeNames.contains { $0.contains("HandGestureShortcut") })
        XCTAssertEqual(Set(content.selections.map(\.id)), ["r1", "r2"])
        XCTAssertEqual(BalancesScreen.crownStep, 1)
        XCTAssertEqual(screen.crownUpperBound, 1)
    }

    func testHeaderAndDoubleTapButtonsDriveTheSameToggle() throws {
        var recorded: [WatchUnitsMode] = []
        let screen = make(mode: .fiat, setMode: { recorded.append($0) })
        let header = try XCTUnwrap(screen.display.header)
        let headerBody = screen.headerButton(header).body
        let shortcut = screen.doubleTapShortcut
        let headerContent = renderedContent(in: headerBody)
        let shortcutContent = renderedContent(in: shortcut)
        let headerButton = try XCTUnwrap(renderedButtons(in: headerBody).first)
        let shortcutButton = try XCTUnwrap(renderedButtons(in: shortcut).first)

        XCTAssertTrue(headerContent.typeNames.contains { $0.hasPrefix("SwiftUI.Button<") })
        XCTAssertTrue(shortcutContent.typeNames.contains { $0.hasPrefix("SwiftUI.Button<") })
        XCTAssertTrue(shortcutContent.typeNames.contains { $0.contains("HandGestureShortcut") })
        XCTAssertTrue(invokeAction(in: headerButton))
        XCTAssertTrue(invokeAction(in: shortcutButton))

        XCTAssertEqual(recorded, [.units, .units])
    }

    func testHeaderSwitchesUnitsToFiat() throws {
        var recorded: WatchUnitsMode?
        let screen = make(mode: .units, setMode: { recorded = $0 })
        let header = try XCTUnwrap(screen.display.header)
        let button = try XCTUnwrap(renderedButtons(in: screen.headerButton(header).body).first)

        XCTAssertTrue(invokeAction(in: button))
        XCTAssertEqual(recorded, .fiat)
    }

    func testToolbarButtonsOpenTheirRenderedDestinations() throws {
        var opened: [WatchScreen] = []
        let screen = make(open: { opened.append($0) })
        let buttons = try XCTUnwrap(renderedToolbarButtons(in: screen.body))

        XCTAssertEqual(buttons.count, 3)
        XCTAssertEqual(
            Set(buttons.flatMap { renderedContent(in: $0).strings }),
            ["bell", "qrcode", "info.circle"]
        )
        for button in buttons {
            XCTAssertTrue(invokeAction(in: button))
        }

        XCTAssertEqual(opened, [.alerts, .receive, .status])
    }

    func testToggleIsIgnoredOnTestNetwork() throws {
        var recorded: WatchUnitsMode?
        let screen = make(isTest: true, setMode: { recorded = $0 })
        let header = try XCTUnwrap(screen.display.header)
        let button = try XCTUnwrap(renderedButtons(in: screen.headerButton(header).body).first)

        XCTAssertTrue(invokeAction(in: button))
        XCTAssertNil(recorded)
    }

    func testUnreadCountsOnlyUnreadInboxItems() throws {
        let screen = make(inbox: [
            item("a", read: false), item("b", read: true), item("c", read: false)
        ])

        XCTAssertEqual(screen.unread, 2)
        XCTAssertTrue(
            try XCTUnwrap(renderedToolbarButtons(in: screen.body))
                .flatMap { renderedContent(in: $0).strings }
                .contains("bell.badge")
        )
    }

    func testDisplayFollowsModeAndUsesSharedPresenterTypes() {
        let fiat: BalancesDisplay = make(mode: .fiat).display
        let units: BalancesDisplay = make(mode: .units).display
        let line: BalanceLine? = fiat.lines.first
        let text: BalanceText? = line?.primary

        XCTAssertEqual(fiat.lines.count, 2)
        XCTAssertEqual(text?.text, "$5.00")
        XCTAssertEqual(units.lines.first?.primary?.text, "1.5 BTC")
    }

    func testNilSnapshotShowsLoadingWithoutRows() {
        let screen = BalancesScreen(
            snapshot: nil, mode: nil, phoneReachable: true, now: nil,
            setMode: { _ in }, open: { _ in }
        )

        XCTAssertEqual(screen.display.banners, ["state.loading"])
        XCTAssertTrue(screen.rows.isEmpty)
        XCTAssertEqual(screen.unread, 0)
    }

    private func invokeAction(in value: Any, depth: Int = 0) -> Bool {
        guard depth < 40 else { return false }
        for child in Mirror(reflecting: value).children {
            if child.label == "action", let action = child.value as? (() -> Void) {
                action()
                return true
            }
            if child.label == "closure",
               let action = child.value as? (@MainActor () -> Void) {
                action()
                return true
            }
            if invokeAction(in: child.value, depth: depth + 1) { return true }
        }
        return false
    }

    private func renderedContent(in value: Any) -> (
        strings: Set<String>,
        selections: [BalanceSelection],
        typeNames: Set<String>
    ) {
        var strings = Set<String>()
        var selections: [BalanceSelection] = []
        var typeNames = Set<String>()
        var visited = Set<ObjectIdentifier>()

        func visit(_ value: Any, depth: Int) {
            guard depth < 50 else { return }
            typeNames.insert(String(reflecting: type(of: value)))
            if let string = value as? String { strings.insert(string) }
            if let selection = value as? BalanceSelection { selections.append(selection) }

            let mirror = Mirror(reflecting: value)
            if mirror.displayStyle == .class {
                let identifier = ObjectIdentifier(value as AnyObject)
                guard visited.insert(identifier).inserted else { return }
            }
            for child in mirror.children { visit(child.value, depth: depth + 1) }
        }

        visit(value, depth: 0)
        return (strings, selections, typeNames)
    }

    private func renderedButtons(in value: Any) -> [Any] {
        var buttons: [Any] = []

        func visit(_ value: Any, depth: Int) {
            guard depth < 40 else { return }
            if String(reflecting: type(of: value)).hasPrefix("SwiftUI.Button<") {
                buttons.append(value)
                return
            }
            for child in Mirror(reflecting: value).children {
                visit(child.value, depth: depth + 1)
            }
        }

        visit(value, depth: 0)
        return buttons
    }

    private func renderedToolbarButtons(in value: Any, depth: Int = 0) -> [Any]? {
        guard depth < 40 else { return nil }
        if let toolbar = value as? BalancesToolbar {
            return renderedButtons(in: toolbar.body)
        }
        for child in Mirror(reflecting: value).children {
            if let buttons = renderedToolbarButtons(in: child.value, depth: depth + 1) {
                return buttons
            }
        }
        return nil
    }

    private func make(
        mode: WatchUnitsMode? = nil,
        isTest: Bool = false,
        inbox: [SnapshotInboxItem] = [],
        setMode: @escaping (WatchUnitsMode) -> Void = { _ in },
        open: @escaping (WatchScreen) -> Void = { _ in }
    ) -> BalancesScreen {
        BalancesScreen(
            snapshot: snapshot(isTest: isTest, inbox: inbox),
            mode: mode,
            phoneReachable: true,
            now: 1_000,
            setMode: setMode,
            open: open
        )
    }

    private func item(_ id: String, read: Bool) -> SnapshotInboxItem {
        SnapshotInboxItem(
            id: id, family: "messages", kind: "k", title: "t", body: "b", at: 1, read: read
        )
    }

    private func snapshot(isTest: Bool, inbox: [SnapshotInboxItem]) -> Snapshot {
        Snapshot(
            v: 1, builtAt: 1_000, balancesAt: 1_000, pricesAt: 1_000, session: "unlocked",
            network: SnapshotNetwork(kind: isTest ? "testnet" : "mainnet", isTest: isTest),
            fiatCode: "USD", hidden: false, unitDefault: "fiat", walletName: "w",
            totals: SnapshotTotals(fiatText: "$8.00", unitsText: "3.5 coins"),
            rows: [
                row(id: "r1", name: "Bitcoin", tick: "BTC", amount: "1.5 BTC", fiat: "$5.00"),
                row(id: "r2", name: "Litecoin", tick: "LTC", amount: "2 LTC", fiat: "$3.00")
            ],
            capped: false, receive: [], inbox: inbox,
            request: Request(
                id: "q", kind: .request, iconHash: "", sentence: "s",
                amountText: "1", expiresAt: nil
            ),
            settings: SnapshotSettings(showTotal: true, enabled: true)
        )
    }

    private func row(
        id: String, name: String, tick: String, amount: String, fiat: String
    ) -> SnapshotRow {
        SnapshotRow(
            id: id, chainId: "\(tick.lowercased())-mainnet", tick: tick, displayName: name,
            amountText: amount, fiatText: fiat, noPrice: false, pendingText: "",
            unavailable: false, iconHash: "", tickerColor: "#F7931A", hasDetail: true
        )
    }
}
