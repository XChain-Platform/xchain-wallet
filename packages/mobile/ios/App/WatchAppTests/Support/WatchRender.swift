// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import WatchKit

@MainActor
enum WatchRender {
    static func screenSize() -> CGSize {
        WKInterfaceDevice.current().screenBounds.size
    }

    static func image(
        _ view: some View,
        size: CGSize,
        dynamicTypeSize: DynamicTypeSize = .large
    ) -> CGImage? {
        let renderer = ImageRenderer(
            content: view
                .frame(width: size.width, height: size.height)
                .environment(\.dynamicTypeSize, dynamicTypeSize)
        )
        renderer.scale = 2
        return renderer.cgImage
    }

    static func isBlank(_ image: CGImage) -> Bool {
        let width = image.width
        let height = image.height
        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
            | CGBitmapInfo.byteOrder32Big.rawValue

        let didDraw = pixels.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(
                data: bytes.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: bitmapInfo
            ) else {
                return false
            }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }

        guard didDraw, pixels.count >= bytesPerPixel else { return false }
        let first = Array(pixels.prefix(bytesPerPixel))
        return stride(from: 0, to: pixels.count, by: bytesPerPixel).allSatisfy { offset in
            pixels[offset ..< offset + bytesPerPixel].elementsEqual(first)
        }
    }

    static func idealWidth(
        of text: String,
        font: Font,
        dynamicTypeSize: DynamicTypeSize
    ) -> CGFloat? {
        let renderer = ImageRenderer(
            content: Text(text)
                .font(font)
                .lineLimit(1)
                .fixedSize()
                .environment(\.dynamicTypeSize, dynamicTypeSize)
        )
        renderer.scale = 2
        renderer.proposedSize = .unspecified
        guard let image = renderer.cgImage else { return nil }
        return CGFloat(image.width) / renderer.scale
    }

    static func fits(
        _ text: String,
        font: Font,
        dynamicTypeSize: DynamicTypeSize,
        width: CGFloat
    ) -> Bool {
        guard let idealWidth = idealWidth(
            of: text,
            font: font,
            dynamicTypeSize: dynamicTypeSize
        ) else {
            return false
        }
        return idealWidth <= width
    }

    static func strings(in value: Any) -> Set<String> {
        var strings = Set<String>()
        var visited = Set<ObjectIdentifier>()

        func visit(_ value: Any, depth: Int) {
            guard depth < 40 else { return }
            if let string = value as? String {
                strings.insert(string)
                return
            }

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
        return strings
    }
}
