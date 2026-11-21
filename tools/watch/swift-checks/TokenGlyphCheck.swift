// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct TokenGlyphCheck {
    static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAIL: \(name)\n".utf8))
        exit(1)
    }

    static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fail(name)
        }
    }

    static func main() throws {
        require(TokenGlyph.letter(tick: "xcp") == "X", "letter xcp")
        require(TokenGlyph.letter(tick: "A") == "A", "letter A")
        require(TokenGlyph.letter(tick: "") == "?", "letter empty")
        require(TokenGlyph.letter(tick: nil) == "?", "letter nil")

        guard let rgb = TokenGlyph.rgb(hex: "#1A74A8") else {
            fail("rgb valid")
        }
        require(rgb.r == 26.0 / 255.0, "rgb red")
        require(rgb.g == 116.0 / 255.0, "rgb green")
        require(rgb.b == 168.0 / 255.0, "rgb blue")

        let invalidColors = [
            "#1a74a8", "#FFF", "1A74A8", "#1A74A8FF", "#GGGGGG", "",
        ]
        for color in invalidColors {
            require(TokenGlyph.rgb(hex: color) == nil, "invalid color \(color.debugDescription)")
        }

        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let assetMarkURL = root.appendingPathComponent("packages/core/src/ui/AssetMark.jsx")
        let source = try String(contentsOf: assetMarkURL, encoding: .utf8)
        guard let paletteStart = source.range(of: "const PALETTE = ["),
              let paletteEnd = source.range(of: "];", range: paletteStart.upperBound..<source.endIndex) else {
            fail("read PALETTE")
        }

        let paletteSource = String(source[paletteStart.upperBound..<paletteEnd.lowerBound])
        let pattern = try NSRegularExpression(pattern: "#[0-9A-F]{6}")
        let range = NSRange(paletteSource.startIndex..<paletteSource.endIndex, in: paletteSource)
        let colors = pattern.matches(in: paletteSource, range: range).compactMap { match -> String? in
            guard let matchRange = Range(match.range, in: paletteSource) else {
                return nil
            }
            return String(paletteSource[matchRange])
        }

        require(colors.count >= 15, "PALETTE count")
        for color in colors {
            require(TokenGlyph.rgb(hex: color) != nil, "PALETTE color \(color)")
        }
    }
}
