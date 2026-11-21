// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum TokenGlyph {
    static func letter(tick: String?) -> String {
        guard let first = tick?.first else {
            return "?"
        }
        return String(first).uppercased()
    }

    static func rgb(hex: String) -> (r: Double, g: Double, b: Double)? {
        let bytes = Array(hex.utf8)
        guard bytes.count == 7, bytes[0] == 35 else {
            return nil
        }

        func nibble(_ byte: UInt8) -> UInt8? {
            switch byte {
            case 48...57:
                return byte - 48
            case 65...70:
                return byte - 55
            default:
                return nil
            }
        }

        func component(at index: Int) -> Double? {
            guard let high = nibble(bytes[index]),
                  let low = nibble(bytes[index + 1]) else {
                return nil
            }
            return Double(high * 16 + low) / 255.0
        }

        guard let red = component(at: 1),
              let green = component(at: 3),
              let blue = component(at: 5) else {
            return nil
        }
        return (red, green, blue)
    }
}
