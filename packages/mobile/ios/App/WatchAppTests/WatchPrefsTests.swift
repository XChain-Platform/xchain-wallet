// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class WatchPrefsTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        suiteName = "WatchPrefsTests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    func testUnitsModeSeedsFromSnapshotAndPersistsToggles() {
        let prefs = WatchPrefs(defaults: defaults)

        XCTAssertEqual(prefs.unitsMode(unitDefault: "units", isTest: false), .units)
        XCTAssertEqual(prefs.toggleUnits(unitDefault: "units", isTest: false), .fiat)
        XCTAssertEqual(WatchPrefs(defaults: defaults).unitsMode(unitDefault: "units", isTest: false), .fiat)
        XCTAssertEqual(prefs.toggleUnits(unitDefault: "fiat", isTest: false), .units)
        XCTAssertEqual(WatchPrefs(defaults: defaults).unitsMode(unitDefault: "fiat", isTest: false), .units)
    }

    func testTestNetworkForcesUnitsWithoutReplacingStoredMode() {
        let prefs = WatchPrefs(defaults: defaults)
        XCTAssertEqual(prefs.unitsMode(unitDefault: "fiat", isTest: false), .fiat)
        XCTAssertEqual(prefs.toggleUnits(unitDefault: "fiat", isTest: true), .units)
        XCTAssertEqual(WatchPrefs(defaults: defaults).unitsMode(unitDefault: "fiat", isTest: false), .fiat)
    }

    func testHideAmountsDefaultsOffAndPersists() {
        let prefs = WatchPrefs(defaults: defaults)
        XCTAssertFalse(prefs.hideAmounts)

        prefs.hideAmounts = true
        XCTAssertTrue(WatchPrefs(defaults: defaults).hideAmounts)

        WatchPrefs(defaults: defaults).hideAmounts = false
        XCTAssertFalse(prefs.hideAmounts)
    }

    func testProductionSuiteUsesTheWatchAppGroup() {
        XCTAssertEqual(WatchPrefs.appGroup, "group.io.xchain.wallet.ios.watch")
    }
}
