// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class StateBannersTests: XCTestCase {
    func testRendersEveryBanner() {
        for banner in WatchBanner.allCases {
            assertRenders(StateBanners(banners: [banner]), named: banner.rawValue)
        }
    }

    func testRendersEveryAgeLine() {
        let lines: [WatchAgeLine] = [.age, .ageAmber]

        for line in lines {
            assertRenders(Age(line: line, text: "Updated 12 min ago"), named: line.rawValue)
        }
    }

    func testRendersHiddenAmounts() {
        assertRenders(Hidden(hidden: true), named: "hidden")
    }

    private func assertRenders<Content: View>(_ content: Content, named name: String) {
        let renderer = ImageRenderer(content: content)
        renderer.proposedSize = ProposedViewSize(width: 180, height: 80)

        XCTAssertNotNil(renderer.cgImage, name)
    }
}
