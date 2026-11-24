// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import UIKit

struct TokenDetailArtworkView: View {
    let display: TokenDetailDisplay
    let imageData: Data?
    let side: CGFloat

    private var decodedImage: UIImage? {
        guard display.artworkHash != nil, let imageData else {
            return nil
        }
        return UIImage(data: imageData)
    }

    var showsImage: Bool {
        decodedImage != nil
    }

    var glyphText: String {
        display.glyph ?? TokenGlyph.letter(tick: display.tick)
    }

    var body: some View {
        Group {
            if let image = decodedImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else {
                Circle()
                    .fill(glyphColor)
                    .overlay(
                        Text(glyphText)
                            .font(.system(size: side * 0.45, weight: .semibold))
                            .foregroundColor(.white)
                    )
            }
        }
        .frame(width: side, height: side)
    }

    private var glyphColor: Color {
        guard let rgb = display.glyphRGB, rgb.count == 3 else {
            return Color.gray
        }
        return Color(red: rgb[0], green: rgb[1], blue: rgb[2])
    }
}
