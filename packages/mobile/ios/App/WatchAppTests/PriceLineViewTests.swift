import CoreGraphics
import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class PriceLineViewTests: XCTestCase {
    func testRendersDetailNativeChart() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let data = try WatchFixtureFiles.data("detail-native", in: directory)
        let detail = try JSONDecoder().decode(Detail.self, from: data)
        let chart = try XCTUnwrap(detail.chart)

        XCTAssertEqual(chart.points.count, 48)
        XCTAssertFalse(chart.up)
        XCTAssertEqual(PriceLineScale.xDomain(count: chart.points.count), 0...47)
        XCTAssertEqual(PriceLineScale.yDomain(chart.points), 24_500...48_000)

        let renderer = ImageRenderer(
            content: PriceLineView(chart: chart)
                .frame(width: 160, height: 80)
        )
        renderer.scale = 2

        let image = try XCTUnwrap(renderer.cgImage)
        let counts = try dominantPixelCounts(in: image)
        XCTAssertGreaterThan(counts.red, 100)
        XCTAssertEqual(counts.green, 0)
    }

    private func dominantPixelCounts(in image: CGImage) throws -> (red: Int, green: Int) {
        let bytesPerRow = image.width * 4
        var pixels = [UInt8](repeating: 0, count: bytesPerRow * image.height)

        return try pixels.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(
                data: buffer.baseAddress,
                width: image.width,
                height: image.height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue
                    | CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))

            return stride(from: 0, to: buffer.count, by: 4).reduce(into: (red: 0, green: 0)) { counts, offset in
                let red = Int(buffer[offset])
                let green = Int(buffer[offset + 1])
                let blue = Int(buffer[offset + 2])
                counts.red += red > green * 2 && red > blue * 2 ? 1 : 0
                counts.green += green > red * 2 && green > blue * 2 ? 1 : 0
            }
        }
    }
}
