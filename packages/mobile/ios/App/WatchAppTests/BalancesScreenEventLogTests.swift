// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

@MainActor
final class BalancesScreenEventLogTests: XCTestCase {
    func testBodyAppearanceDelegatesToAppeared() throws {
        let source = try String(contentsOf: balancesScreenSourceURL(), encoding: .utf8)

        XCTAssertTrue(source.contains(".onAppear { appeared() }"))
    }

    func testBodyAppearanceCallsRecordingHook() throws {
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

        XCTAssertTrue(invokeAppearance(in: screen.body))
        XCTAssertEqual(shownCount, 1)
    }

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

    private func invokeAppearance(in value: Any, depth: Int = 0) -> Bool {
        guard depth < 40 else { return false }
        let mirror = Mirror(reflecting: value)
        if String(reflecting: type(of: value)).hasSuffix("._AppearanceActionModifier") {
            for child in mirror.children where child.label == "appear" {
                return invokeClosure(in: child.value)
            }
            return false
        }
        for child in mirror.children {
            if invokeAppearance(in: child.value, depth: depth + 1) { return true }
        }
        return false
    }

    private func invokeClosure(in value: Any, depth: Int = 0) -> Bool {
        guard depth < 10 else { return false }
        if let action = value as? (() -> Void) {
            action()
            return true
        }
        if let action = value as? (@MainActor () -> Void) {
            action()
            return true
        }
        for child in Mirror(reflecting: value).children {
            if invokeClosure(in: child.value, depth: depth + 1) { return true }
        }
        return false
    }

    private func snapshot() throws -> Snapshot {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        return try JSONDecoder().decode(
            Snapshot.self,
            from: WatchFixtureFiles.data("snapshot-rows50", in: directory)
        )
    }

    private func balancesScreenSourceURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("WatchApp/Screens/BalancesScreen.swift")
    }
}
