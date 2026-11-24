// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

final class NotSetUpScreenTests: XCTestCase {
    func testTextResolvesContractCopy() {
        XCTAssertEqual(
            NotSetUpScreen.text(for: "state.openWalletOnPhone"),
            "Open XChain Wallet on your phone"
        )
        XCTAssertEqual(
            NotSetUpScreen.text(for: "state.watchDisabled"),
            "Show wallet on watch is off on your phone"
        )
    }

    func testGraphSelectsNotSetUpTextKeys() {
        XCTAssertEqual(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: false, enabled: false),
            "state.openWalletOnPhone"
        )
        XCTAssertEqual(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: true, enabled: false),
            "state.watchDisabled"
        )
    }

    @MainActor
    func testScreensRenderInWatchFrame() {
        let keys = ["state.openWalletOnPhone", "state.watchDisabled"]

        for key in keys {
            let screen = NotSetUpScreen(textKey: key)
                .frame(width: 176, height: 215)
            let renderer = ImageRenderer(content: screen)

            XCTAssertNotNil(renderer.cgImage, key)
        }
    }
}
