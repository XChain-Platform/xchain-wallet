// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

@MainActor
final class BalancesScreenEventLogTests: XCTestCase {
    func testAppearedCallsRecordingHookForEveryAppearance() throws {
        var shownCount = 0
        let screen = BalancesScreen(
            snapshot: try snapshot(),
            mode: .fiat,
            phoneReachable: true,
            now: 1_700_000_000_000,
            setMode: { _ in },
            open: { _ in },
            onShown: { shownCount += 1 }
        )

        screen.appeared()
        XCTAssertEqual(shownCount, 1)

        screen.appeared()
        XCTAssertEqual(shownCount, 2)
    }

    func testAppearedReturnsWithDefaultHook() throws {
        let screen = BalancesScreen(
            snapshot: try snapshot(),
            mode: .fiat,
            phoneReachable: true,
            now: 1_700_000_000_000,
            setMode: { _ in },
            open: { _ in }
        )

        screen.appeared()
    }

    private func snapshot() throws -> Snapshot {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        return try JSONDecoder().decode(
            Snapshot.self,
            from: WatchFixtureFiles.data("snapshot-rows50", in: directory)
        )
    }
}
