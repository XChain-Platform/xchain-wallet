// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class StatusScreenTests: XCTestCase {
    private func screen(reachable: Bool = true, session: String? = "unlocked", hide: Bool = false,
                        onToggle: @escaping (Bool) -> Void = { _ in }) -> StatusScreen {
        StatusScreen(reachable: reachable, balancesAt: 1_700_000_000_000, session: session,
                     hideAmounts: hide, appVersion: "1.2.3", onToggleHideAmounts: onToggle)
    }

    func testRowsCarryTheFiveInputs() {
        let rows = screen().rows
        XCTAssertEqual(rows.map(\.labelKey), ["state.phoneReachable", "state.lastSync", "state.session",
                                              "state.hideAmounts", "state.version"])
        XCTAssertEqual(rows[0].value, .flag(true))
        XCTAssertEqual(rows[1].value, .age(balancesAt: 1_700_000_000_000))
        XCTAssertEqual(rows[2].value, .session(locked: false))
        XCTAssertEqual(rows[3].value, .toggle(false))
        XCTAssertEqual(rows[4].value, .text("1.2.3"))
    }

    func testUnreachablePhoneHidesSessionState() {
        XCTAssertEqual(screen(reachable: false).rows[2].value, .sessionUnknown)
    }

    func testToggleClosureRecordsTheNewValue() {
        var recorded: [Bool] = []
        let view = screen(onToggle: { recorded.append($0) })
        view.onToggleHideAmounts(true)
        view.onToggleHideAmounts(false)
        XCTAssertEqual(recorded, [true, false])
    }

    func testValueTextForFixedStates() {
        let view = screen()
        XCTAssertEqual(view.text(.text("1.2.3")), "1.2.3")
        XCTAssertEqual(view.text(.none), "-")
        XCTAssertEqual(view.text(.session(locked: true)), "Locked")
    }
}
