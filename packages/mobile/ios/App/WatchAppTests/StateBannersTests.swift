// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import CoreGraphics
import Foundation
import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class StateBannersTests: XCTestCase {
    func testRendersEveryBanner() {
        let expectedText: [WatchBanner: String] = [
            .loading: "Waiting for phone",
            .locked: "Wallet locked on phone",
            .unreachable: "Phone not in range",
            .stale24h: "Open XChain Wallet on your phone to refresh",
        ]

        for banner in WatchBanner.allCases {
            let text = expectedText[banner]!
            XCTAssertEqual(StateBannerRules.textKey(banner), "state.\(banner.rawValue)")
            assertRenders(
                StateBanners(banners: [banner]),
                matching: expectedBanner(text),
                named: banner.rawValue
            )
        }
    }

    func testRendersNamedBannerViews() {
        XCTAssertEqual(Loading.textKey, "state.loading")
        assertRenders(Loading(), matching: expectedText("Waiting for phone"), named: "loading")

        XCTAssertEqual(Locked.textKey, "state.locked")
        assertRenders(Locked(), matching: expectedText("Wallet locked on phone"), named: "locked")

        XCTAssertEqual(Unreachable.textKey, "state.unreachable")
        assertRenders(Unreachable(), matching: expectedText("Phone not in range"), named: "unreachable")
    }

    func testRendersEveryAgeLine() {
        let expectedKeys: [WatchAgeLine: String] = [
            .age: "state.age",
            .ageAmber: "state.ageAmber",
        ]
        let text = "Updated 12 min ago"

        for line in expectedKeys.keys {
            let view = Age(line: line, text: text)
            XCTAssertEqual(StateBannerRules.textKey(view.line), expectedKeys[line], line.rawValue)
            XCTAssertEqual(view.text, text, line.rawValue)
            assertRenders(view, matching: expectedAge(line, text: text), named: line.rawValue)
        }
    }

    func testRendersHiddenAmounts() {
        XCTAssertEqual(Hidden.textKey, "state.hidden")
        XCTAssertEqual(Hidden.accessibilityKey, "state.amountHidden")
        assertRenders(Hidden(hidden: true), matching: Text(verbatim: "••••"), named: "hidden")
    }

    private func expectedBanner(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            expectedText(text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func expectedText(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.caption2)
    }

    private func expectedAge(_ line: WatchAgeLine, text: String) -> some View {
        let amber = Color(red: 232.0 / 255.0, green: 161.0 / 255.0, blue: 0)
        return expectedText(text)
            .foregroundStyle(line == .ageAmber ? amber : Color.primary)
    }

    private func assertRenders<Content: View, Expected: View>(
        _ content: Content,
        matching expected: Expected,
        named name: String
    ) {
        guard let image = render(content), let expectedImage = render(expected) else {
            XCTFail("\(name) did not render")
            return
        }

        XCTAssertEqual(image.width, expectedImage.width, name)
        XCTAssertEqual(image.height, expectedImage.height, name)
        XCTAssertEqual(pixelData(image), pixelData(expectedImage), name)
    }

    private func render<Content: View>(_ content: Content) -> CGImage? {
        let renderer = ImageRenderer(content: content)
        renderer.proposedSize = ProposedViewSize(width: 180, height: 80)
        return renderer.cgImage
    }

    private func pixelData(_ image: CGImage) -> Data? {
        image.dataProvider?.data as Data?
    }
}
