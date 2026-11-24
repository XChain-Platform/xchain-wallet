// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class TokenDetailScreenTests: XCTestCase {
    func testRendersIdentityAmountsChartAndFactsOnBothCaseSizes() throws {
        let detail = try fixture("detail-native")
        let screen = TokenDetailScreen(
            display: TokenDetailPresenter.present(
                row: row(id: detail.tokenId, tick: "BTC"),
                detail: detail,
                phoneReachable: true
            ),
            onOpenOnPhone: {}
        )

        let content = renderedContent(in: screen.body)

        XCTAssertTrue(content.strings.contains("Bitcoin"))
        XCTAssertTrue(content.strings.contains("BTC"))
        XCTAssertTrue(content.strings.contains("0.50 BTC"))
        XCTAssertTrue(content.strings.contains("w2.change24h"))
        XCTAssertTrue(content.strings.contains("-6.25% over 24 h"))
        XCTAssertTrue(content.strings.contains("w2.priceSource"))
        XCTAssertTrue(content.strings.contains("CoinGecko"))
        XCTAssertTrue(content.strings.contains("w2.openOnPhone"))
        XCTAssertNotNil(descendant(in: screen.body) {
            String(reflecting: type(of: $0)).hasSuffix("PriceLineView")
        })
        XCTAssertNotNil(render(screen, width: 176, height: 215))
        XCTAssertNotNil(render(screen, width: 205, height: 251))
    }

    func testRenderedTapsToggleAmountAndArtworkAndFireOpenAction() throws {
        let detail = try fixture("detail-cached")
        let state = TokenDetailScreenState()
        var openCount = 0
        let screen = TokenDetailScreen(
            display: TokenDetailPresenter.present(
                row: row(id: detail.tokenId), detail: detail, phoneReachable: true
            ),
            state: state,
            onOpenOnPhone: { openCount += 1 }
        )

        let content = renderedContent(in: screen.body)
        for expected in [
            "XChain", "XC", "42 XC", "w2.change24h", "+4.75% over 24 h",
            "w2.priceSource", "XChain DEX", "Type", "Token", "Supply",
            "1,000,000 XC", "Divisibility", "6 decimals", "Status", "Mutable",
            "Creator", "xc1qab...7pq999", "w2.description",
            "A cached token used to verify that watch detail screens render phone-formatted facts and descriptions.",
            "w2.openOnPhone",
        ] {
            XCTAssertTrue(content.strings.contains(expected), expected)
        }

        try invoke(renderedButton(labeled: "42 XC", in: screen.body))
        let valueContent = renderedContent(in: screen.body)
        XCTAssertTrue(valueContent.strings.contains("$1,234.56"))
        XCTAssertFalse(valueContent.strings.contains("42 XC"))

        try invoke(renderedButton(labeled: "w2.openOnPhone", in: screen.body))
        XCTAssertEqual(openCount, 1)

        try invoke(renderedButton(labeled: "X", in: screen.body))
        XCTAssertTrue(state.artworkExpanded)
        XCTAssertNotNil(render(screen, width: 176, height: 215))
        screen.toggleArtwork()
        XCTAssertFalse(state.artworkExpanded)
    }

    func testArtworkUsesImageOnlyWhenHashAndDecodableDataArePresent() throws {
        let detail = try fixture("detail-cached")
        let display = TokenDetailPresenter.present(
            row: row(id: detail.tokenId), detail: detail, phoneReachable: true,
            availableArtworkHashes: ["xc-artwork-cache"]
        )
        let png = try XCTUnwrap(Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))
        let imageScreen = TokenDetailScreen(
            display: display, imageData: png, onOpenOnPhone: {}
        )
        let glyphScreen = TokenDetailScreen(
            display: display, imageData: Data(), onOpenOnPhone: {}
        )

        let imageButton = try XCTUnwrap(renderedButtons(in: imageScreen.body).first)
        XCTAssertNotNil(descendant(in: imageButton) {
            String(reflecting: type(of: $0)) == "SwiftUI.Image"
        })
        XCTAssertNotNil(renderedButton(labeled: "X", in: glyphScreen.body))
    }

    func testMissingDetailRendersNearPhoneNoticeWithoutChart() {
        let screen = TokenDetailScreen(
            display: TokenDetailPresenter.present(
                row: row(id: "bitcoin-mainnet:XC"), detail: nil, phoneReachable: false
            ),
            onOpenOnPhone: {}
        )

        let content = renderedContent(in: screen.body)

        XCTAssertTrue(content.strings.contains("XChain"))
        XCTAssertTrue(content.strings.contains("XC"))
        XCTAssertTrue(content.strings.contains("42 XC"))
        XCTAssertTrue(content.strings.contains("w2.moreDetails"))
        XCTAssertTrue(content.strings.contains("w2.openOnPhone"))
        XCTAssertNil(descendant(in: screen.body) {
            String(reflecting: type(of: $0)).hasSuffix("PriceLineView")
        })
        XCTAssertNotNil(render(screen, width: 176, height: 215))
    }

    private func renderedContent(in value: Any) -> (strings: Set<String>, types: Set<String>) {
        var strings = Set<String>()
        var types = Set<String>()
        var visited = Set<ObjectIdentifier>()

        func visit(_ value: Any, depth: Int) {
            guard depth < 40 else { return }
            if let string = value as? String {
                strings.insert(string)
                return
            }

            types.insert(String(reflecting: type(of: value)))
            let mirror = Mirror(reflecting: value)
            if mirror.displayStyle == .class {
                let identifier = ObjectIdentifier(value as AnyObject)
                guard visited.insert(identifier).inserted else { return }
            }
            for child in mirror.children {
                visit(child.value, depth: depth + 1)
            }
        }

        visit(value, depth: 0)
        return (strings, types)
    }

    private func renderedButton(labeled label: String, in value: Any) -> Any? {
        renderedButtons(in: value).first {
            renderedContent(in: $0).strings.contains(label)
        }
    }

    private func renderedButtons(in value: Any) -> [Any] {
        var buttons: [Any] = []

        func visit(_ value: Any) {
            if String(reflecting: type(of: value)).hasPrefix("SwiftUI.Button<") {
                buttons.append(value)
                return
            }
            for child in Mirror(reflecting: value).children {
                visit(child.value)
            }
        }

        visit(value)
        return buttons
    }

    private func invoke(_ button: Any?) throws {
        let button = try XCTUnwrap(button, "Rendered body has no matching button")
        let installedAction = try XCTUnwrap(
            Mirror(reflecting: button).children.first { $0.label == "action" }?.value,
            "Rendered button has no action"
        )
        let trigger = try XCTUnwrap(
            Mirror(reflecting: installedAction).children
                .first { $0.label == "closure" }?.value as? @MainActor () -> Void,
            "Rendered button has no trigger closure"
        )
        trigger()
    }

    private func descendant(in value: Any, matching predicate: (Any) -> Bool) -> Any? {
        if predicate(value) {
            return value
        }
        for child in Mirror(reflecting: value).children {
            if let match = descendant(in: child.value, matching: predicate) {
                return match
            }
        }
        return nil
    }

    private func fixture(_ name: String) throws -> Detail {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        return try JSONDecoder().decode(
            Detail.self, from: WatchFixtureFiles.data(name, in: directory)
        )
    }

    private func row(id: String, tick: String = "XC") -> SnapshotRow {
        SnapshotRow(
            id: id, chainId: "bitcoin-mainnet", tick: tick,
            displayName: tick == "BTC" ? "Bitcoin" : "XChain",
            amountText: tick == "BTC" ? "0.50 BTC" : "42 XC",
            fiatText: "$1,234.56", noPrice: false, pendingText: "",
            unavailable: false, iconHash: "icon-cache", tickerColor: "#1A74A8",
            hasDetail: true
        )
    }

    private func render(_ view: TokenDetailScreen, width: CGFloat, height: CGFloat) -> CGImage? {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        renderer.scale = 2
        return renderer.cgImage
    }
}
