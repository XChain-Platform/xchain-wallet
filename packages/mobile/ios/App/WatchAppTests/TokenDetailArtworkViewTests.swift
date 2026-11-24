// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import ImageIO
import SwiftUI
import UIKit
import XCTest
@testable import WatchApp

@MainActor
final class TokenDetailArtworkViewTests: XCTestCase {
    func testNoAvailableHashShowsThePresenterGlyph() throws {
        let display = try present("detail-noart")
        let view = TokenDetailArtworkView(display: display, imageData: try png(), side: 48)

        XCTAssertFalse(view.showsImage)
        XCTAssertEqual(view.glyphText, display.glyph)
        XCTAssertEqual(view.glyphText, "X")
    }

    func testAvailableHashWithPngDataShowsTheImage() throws {
        let display = try present("detail-cached", available: ["xc-artwork-cache"])
        let view = TokenDetailArtworkView(display: display, imageData: try png(), side: 48)

        XCTAssertNotNil(display.artworkHash)
        XCTAssertTrue(view.showsImage)
    }

    func testUndecodableBytesFallBackToTheTickerLetter() throws {
        let display = try present("detail-cached", available: ["xc-artwork-cache"])
        let view = TokenDetailArtworkView(
            display: display,
            imageData: Data("not a png".utf8),
            side: 48
        )

        XCTAssertFalse(view.showsImage)
        XCTAssertEqual(view.glyphText, TokenGlyph.letter(tick: "XC"))
    }

    func testRendersAtBothSidesForGlyphAndImage() throws {
        let glyph = try present("detail-noart")
        let artwork = try present("detail-cached", available: ["xc-artwork-cache"])
        let data = try png()

        for side in [CGFloat(48), CGFloat(160)] {
            XCTAssertNotNil(render(TokenDetailArtworkView(display: glyph, imageData: nil, side: side)))
            XCTAssertNotNil(render(TokenDetailArtworkView(display: artwork, imageData: data, side: side)))
        }
    }

    private func render(_ view: TokenDetailArtworkView) -> CGImage? {
        ImageRenderer(content: view).cgImage
    }

    private func present(_ name: String, available: Set<String> = []) throws -> TokenDetailDisplay {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let detail = try JSONDecoder().decode(
            Detail.self,
            from: WatchFixtureFiles.data(name, in: directory)
        )
        return TokenDetailPresenter.present(
            row: row(id: detail.tokenId),
            detail: detail,
            phoneReachable: true,
            availableArtworkHashes: available
        )
    }

    private func row(id: String) -> SnapshotRow {
        SnapshotRow(
            id: id,
            chainId: "bitcoin-mainnet",
            tick: "XC",
            displayName: "XChain",
            amountText: "42 XC",
            fiatText: "$1,234.56",
            noPrice: false,
            pendingText: "",
            unavailable: false,
            iconHash: "icon-cache",
            tickerColor: "#1A74A8",
            hasDetail: true
        )
    }

    private func png() throws -> Data {
        var pixels = [UInt8](repeating: 0, count: 4 * 4 * 4)
        for index in stride(from: 0, to: pixels.count, by: 4) {
            pixels[index] = 200
            pixels[index + 3] = 255
        }
        let provider = try XCTUnwrap(CGDataProvider(data: Data(pixels) as CFData))
        let image = try XCTUnwrap(CGImage(
            width: 4,
            height: 4,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: 16,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ))
        let output = NSMutableData()
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithData(output, "public.png" as CFString, 1, nil)
        )
        CGImageDestinationAddImage(destination, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }
}
