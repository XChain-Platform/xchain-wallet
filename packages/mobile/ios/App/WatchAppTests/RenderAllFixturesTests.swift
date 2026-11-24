// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import CoreGraphics
import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class RenderAllFixturesTests: XCTestCase {
    private struct InkBounds {
        let width: CGFloat
        let height: CGFloat
    }

    private let decoder = JSONDecoder()
    private let now: Int64 = 1_700_000_000_000

    func testRendersEveryScreenAndLongLookWithEveryFixture() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let size = WatchRender.screenSize()
        let snapshots = try decodedFixtures(
            Snapshot.self,
            prefix: "snapshot-",
            in: directory
        )

        XCTAssertFalse(snapshots.isEmpty, "No snapshot fixtures at \(sizeDescription(size))")
        try renderBalances(snapshots, size: size)
        try renderTokenDetails(snapshots, directory: directory, size: size)
        try renderAlerts(directory: directory, size: size)
        try renderRequests(directory: directory, size: size)
        try renderReceive(snapshots, directory: directory, size: size)
        renderStatus(snapshots, size: size)
        renderNotSetUp(size: size)
    }

    func testRendersLoadingScreen() {
        let size = WatchRender.screenSize()
        assertOutput(
            BalancesScreen(
                snapshot: nil,
                mode: nil,
                phoneReachable: true,
                now: nil,
                setMode: { _ in },
                open: { _ in }
            ),
            screen: "W1",
            fixture: "loading",
            size: size
        )
    }

    private func renderBalances(_ snapshots: [Named<Snapshot>], size: CGSize) throws {
        var scaledAmountAssertions = 0
        for fixture in snapshots {
            for mode in [WatchUnitsMode.fiat, .units] {
                let modeName = mode == .fiat ? "fiat" : "units"
                assertOutput(
                    BalancesScreen(
                        snapshot: fixture.value,
                        mode: mode,
                        phoneReachable: true,
                        now: fixture.value.builtAt,
                        setMode: { _ in },
                        open: { _ in }
                    ),
                    screen: "W1",
                    fixture: "\(fixture.name):\(modeName)",
                    size: size
                )

                let display = BalancesPresenter.present(
                    snapshot: fixture.value,
                    mode: mode,
                    phoneReachable: true,
                    now: fixture.value.builtAt
                )
                XCTAssertTrue(
                    display.header != nil
                        || !display.banners.isEmpty
                        || !display.lines.isEmpty
                        || display.ageLine != nil,
                    "W1 \(fixture.name):\(modeName) has no display content"
                )
                for (row, line) in zip(fixture.value.rows, display.lines) {
                    guard let name = line.name else { continue }
                    let icon = BalanceRowIcon(
                        chainId: row.chainId,
                        tick: row.tick,
                        tickerColor: row.tickerColor
                    )
                    if let amount = line.primary?.text {
                        if try assertRenderedBalanceAmountFits(
                            primary: amount,
                            secondary: line.secondary == nil ? nil : "",
                            name: name,
                            icon: icon,
                            font: .body,
                            fixture: fixture.name,
                            size: size
                        ) {
                            scaledAmountAssertions += 1
                        }
                    }
                    if let amount = line.secondary?.text {
                        if try assertRenderedBalanceAmountFits(
                            primary: "",
                            secondary: amount,
                            name: name,
                            icon: icon,
                            font: .caption2,
                            fixture: fixture.name,
                            size: size
                        ) {
                            scaledAmountAssertions += 1
                        }
                    }
                }
            }
        }
        if BalanceRowRules.stacksNameOverAmount(screenWidth: Double(size.width)) {
            XCTAssertGreaterThan(
                scaledAmountAssertions,
                0,
                "W1 fixtures did not exercise compact amount scaling at \(sizeDescription(size))"
            )
        }
    }

    private func renderTokenDetails(
        _ snapshots: [Named<Snapshot>],
        directory: URL,
        size: CGSize
    ) throws {
        let row = try XCTUnwrap(
            snapshots.lazy.compactMap { $0.value.rows.first }.first,
            "No balance row fixture for W2 at \(sizeDescription(size))"
        )
        let details = try decodedFixtures(Detail.self, prefix: "detail-", in: directory)
        XCTAssertFalse(details.isEmpty, "No detail fixtures at \(sizeDescription(size))")

        for fixture in details {
            let display = TokenDetailPresenter.present(
                row: row,
                detail: fixture.value,
                phoneReachable: true
            )
            XCTAssertFalse(display.displayName.isEmpty, "W2 \(fixture.name) has no name")
            XCTAssertFalse(display.amountText.isEmpty, "W2 \(fixture.name) has no amount")
            XCTAssertFalse(display.valueText.isEmpty, "W2 \(fixture.name) has no value")
            assertOutput(
                TokenDetailContent(display: display, onOpenOnPhone: {}),
                screen: "W2",
                fixture: fixture.name,
                size: size
            )
            assertCompactAmountFits(
                display.amountText,
                font: .title3,
                fixture: fixture.name,
                screen: "W2 units",
                size: size
            )
            assertCompactAmountFits(
                display.valueText,
                font: .title3,
                fixture: fixture.name,
                screen: "W2 fiat",
                size: size
            )
        }
    }

    private func renderAlerts(directory: URL, size: CGSize) throws {
        let inbox = try decode([SnapshotInboxItem].self, named: "inbox-alerts", in: directory)
        XCTAssertFalse(inbox.isEmpty, "No inbox fixtures at \(sizeDescription(size))")
        assertOutput(
            AlertsScreen(inbox: inbox, now: now, markRead: { _ in }),
            screen: "W3",
            fixture: "inbox-alerts",
            size: size
        )

        for item in inbox {
            XCTAssertFalse(item.title.isEmpty, "W4 \(item.id) has no title")
            assertOutput(
                AlertDetailContent(item: item, now: now, onOpenOnPhone: {}),
                screen: "W4",
                fixture: "inbox-alerts:\(item.id)",
                size: size
            )
            for alwaysOn in [false, true] {
                assertOutput(
                    AlertLongLook(item: item, now: now, alwaysOn: alwaysOn),
                    screen: "N1",
                    fixture: "inbox-alerts:\(item.id):\(alwaysOn ? "always-on" : "default")",
                    size: size
                )
            }
        }
    }

    private func renderRequests(directory: URL, size: CGSize) throws {
        let requests = try decodedFixtures(Request.self, prefix: "request-", in: directory)
        XCTAssertFalse(requests.isEmpty, "No request fixtures at \(sizeDescription(size))")

        for fixture in requests {
            XCTAssertFalse(fixture.value.sentence.isEmpty, "W4 \(fixture.name) has no sentence")
            XCTAssertFalse(fixture.value.amountText.isEmpty, "W4 \(fixture.name) has no amount")
            assertOutput(
                AlertDetailContent(request: fixture.value, now: now, onOpenOnPhone: {}),
                screen: "W4",
                fixture: fixture.name,
                size: size
            )
            assertCompactAmountFits(
                fixture.value.amountText,
                font: .body,
                fixture: fixture.name,
                screen: "W4",
                size: size
            )

            let longLook = RequestLongLook(request: fixture.value, openOnPhone: {})
            let renderTime = min(now, (fixture.value.expiresAt ?? now + 1) - 1)
            let date = Date(timeIntervalSince1970: Double(renderTime) / 1_000)
            let content = try XCTUnwrap(
                longLook.presentation(at: date),
                "N2 \(fixture.name) has no pre-expiry content at \(sizeDescription(size))"
            )
            XCTAssertFalse(content.sentence.isEmpty, "N2 \(fixture.name) has no sentence")
            XCTAssertFalse(content.amountText.isEmpty, "N2 \(fixture.name) has no amount")
            assertOutput(
                RequestLongLookContent(
                    content: content,
                    expiresAt: fixture.value.expiresAt,
                    date: date,
                    openOnPhone: {}
                ),
                screen: "N2",
                fixture: fixture.name,
                size: size
            )
            assertCompactAmountFits(
                content.amountText,
                font: .title3.weight(.semibold),
                fixture: fixture.name,
                screen: "N2",
                size: size
            )
        }
    }

    private func renderReceive(
        _ snapshots: [Named<Snapshot>],
        directory: URL,
        size: CGSize
    ) throws {
        let blocks = try decodedFixtures(
            [SnapshotReceive].self,
            prefix: "receive-",
            in: directory
        )
        XCTAssertFalse(blocks.isEmpty, "No receive fixtures at \(sizeDescription(size))")
        for fixture in blocks {
            assertOutput(
                ReceiveScreen(receive: fixture.value),
                screen: "W6",
                fixture: fixture.name,
                size: size
            )
        }
        for fixture in snapshots {
            assertOutput(
                ReceiveScreen(receive: fixture.value.receive),
                screen: "W6",
                fixture: fixture.name,
                size: size
            )
        }
    }

    private func renderStatus(_ snapshots: [Named<Snapshot>], size: CGSize) {
        for fixture in snapshots {
            assertOutput(
                StatusScreen(
                    reachable: true,
                    balancesAt: fixture.value.balancesAt,
                    session: fixture.value.session,
                    hideAmounts: fixture.value.hidden,
                    appVersion: "1.0.0",
                    onToggleHideAmounts: { _ in }
                ),
                screen: "W8",
                fixture: fixture.name,
                size: size
            )
        }
    }

    private func renderNotSetUp(size: CGSize) {
        for (hasSnapshot, enabled) in [(false, true), (true, false)] {
            guard let key = WatchScreenGraph.notSetUpTextKey(
                hasSnapshot: hasSnapshot,
                enabled: enabled
            ) else {
                XCTFail("W9 has no state key at \(sizeDescription(size))")
                continue
            }
            assertOutput(
                NotSetUpScreen(textKey: key),
                screen: "W9",
                fixture: key,
                size: size
            )
        }
    }

    private func decodedFixtures<Value: Decodable>(
        _ type: Value.Type,
        prefix: String,
        in directory: URL
    ) throws -> [Named<Value>] {
        try WatchFixtureFiles.names(prefix: prefix, in: directory).map {
            Named(name: $0, value: try decode(type, named: $0, in: directory))
        }
    }

    private func decode<Value: Decodable>(
        _ type: Value.Type,
        named name: String,
        in directory: URL
    ) throws -> Value {
        try decoder.decode(type, from: WatchFixtureFiles.data(name, in: directory))
    }

    private func assertOutput<ViewType: View>(
        _ view: ViewType,
        screen: String,
        fixture: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let context = "\(screen) \(fixture) at \(sizeDescription(size))"
        guard let image = WatchRender.image(
            view.environment(\.colorScheme, .dark),
            size: size
        ) else {
            XCTFail("\(context) produced no image", file: file, line: line)
            return
        }
        XCTAssertGreaterThan(image.width, 0, "\(context) has no width", file: file, line: line)
        XCTAssertGreaterThan(image.height, 0, "\(context) has no height", file: file, line: line)
        XCTAssertEqual(
            image.width,
            Int(size.width * 2),
            "\(context) rendered at the wrong width",
            file: file,
            line: line
        )
        XCTAssertEqual(
            image.height,
            Int(size.height * 2),
            "\(context) rendered at the wrong height",
            file: file,
            line: line
        )
        XCTAssertFalse(
            WatchRender.isBlank(image),
            "\(context) rendered blank",
            file: file,
            line: line
        )
    }

    private func assertRenderedBalanceAmountFits(
        primary: String,
        secondary: String?,
        name: String,
        icon: BalanceRowIcon,
        font: Font,
        fixture: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> Bool {
        guard BalanceRowRules.stacksNameOverAmount(screenWidth: Double(size.width)) else {
            return false
        }
        let text = primary.isEmpty ? secondary ?? "" : primary
        let contentWidth = size.width - 32
        let amountWidth = contentWidth - CGFloat(BalanceRowRules.iconPoints + 8)
        let content = BalanceRowContent(
            name: name,
            amountCell: (primary, secondary),
            layout: .stacked,
            icon: icon
        )
        let baseline = BalanceRowContent(
            name: name,
            amountCell: ("", secondary == nil ? nil : ""),
            layout: .stacked,
            icon: icon
        )
        let rendered = try inkBounds(
            content,
            subtracting: AnyView(baseline),
            frameWidth: contentWidth,
            frameHeight: 100,
            cropLeading: CGFloat(BalanceRowRules.iconPoints + 8)
        )
        let expected = try inkBounds(
            Text(verbatim: text)
                .font(font)
                .lineLimit(1)
                .minimumScaleFactor(BalanceRowView.amountMinimumScale)
                .frame(width: amountWidth, alignment: .trailing)
        )
        let unscaled = try inkBounds(
            Text(verbatim: text)
                .font(font)
                .lineLimit(1)
                .fixedSize()
        )
        let context = "W1 \(fixture) amount at \(sizeDescription(size)): \(text)"
        XCTAssertEqual(
            rendered.width,
            expected.width,
            accuracy: 1,
            "\(context) rendered at a different width than the production scale factor",
            file: file,
            line: line
        )
        XCTAssertEqual(
            rendered.height,
            expected.height,
            accuracy: 1,
            "\(context) rendered at a different height than the production scale factor",
            file: file,
            line: line
        )
        let exercisesScaling = unscaled.width > amountWidth && expected.height < unscaled.height
        if exercisesScaling {
            XCTAssertLessThan(
                rendered.height,
                unscaled.height,
                "\(context) retained unscaled glyph height and is truncated",
                file: file,
                line: line
            )
        }
        return exercisesScaling
    }

    private func inkBounds<Content: View>(
        _ content: Content,
        subtracting baseline: AnyView? = nil,
        frameWidth: CGFloat? = nil,
        frameHeight: CGFloat? = nil,
        cropLeading: CGFloat = 0
    ) throws -> InkBounds {
        let view = framed(
            AnyView(content.foregroundStyle(.white).environment(\.dynamicTypeSize, .large)),
            width: frameWidth,
            height: frameHeight
        )
        let renderer = ImageRenderer(content: view)
        renderer.scale = 4
        renderer.proposedSize = .unspecified
        let image = try XCTUnwrap(renderer.cgImage)
        let pixels = try pixelData(image)
        let baselinePixels: [UInt8]?
        if let baseline {
            let baselineView = framed(
                AnyView(
                    baseline.foregroundStyle(.white).environment(\.dynamicTypeSize, .large)
                ),
                width: frameWidth,
                height: frameHeight
            )
            let baselineRenderer = ImageRenderer(content: baselineView)
            baselineRenderer.scale = renderer.scale
            baselineRenderer.proposedSize = .unspecified
            let baselineImage = try XCTUnwrap(baselineRenderer.cgImage)
            XCTAssertEqual(baselineImage.width, image.width)
            XCTAssertEqual(baselineImage.height, image.height)
            baselinePixels = try pixelData(baselineImage)
        } else {
            baselinePixels = nil
        }

        let bytesPerPixel = 4
        let bytesPerRow = image.width * bytesPerPixel
        var minX = image.width
        var minY = image.height
        var maxX = -1
        var maxY = -1
        let firstX = min(Int(cropLeading * renderer.scale), image.width)
        for y in 0 ..< image.height {
            for x in firstX ..< image.width {
                let offset = y * bytesPerRow + x * bytesPerPixel
                let differs = baselinePixels.map { baseline in
                    (0 ..< bytesPerPixel).reduce(0) {
                        $0 + abs(Int(pixels[offset + $1]) - Int(baseline[offset + $1]))
                    } > 16
                } ?? true
                if pixels[offset + 3] > 8, differs {
                    minX = min(minX, x)
                    minY = min(minY, y)
                    maxX = max(maxX, x)
                    maxY = max(maxY, y)
                }
            }
        }
        XCTAssertGreaterThanOrEqual(maxX, minX, "Rendered amount has no visible pixels")
        XCTAssertGreaterThanOrEqual(maxY, minY, "Rendered amount has no visible pixels")
        return InkBounds(
            width: CGFloat(maxX - minX + 1) / renderer.scale,
            height: CGFloat(maxY - minY + 1) / renderer.scale
        )
    }

    private func framed(
        _ content: AnyView,
        width: CGFloat?,
        height: CGFloat?
    ) -> AnyView {
        guard width != nil || height != nil else { return content }
        return AnyView(content.frame(width: width, height: height, alignment: .topLeading))
    }

    private func pixelData(_ image: CGImage) throws -> [UInt8] {
        let bytesPerPixel = 4
        let bytesPerRow = image.width * bytesPerPixel
        var pixels = [UInt8](repeating: 0, count: image.height * bytesPerRow)
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
            | CGBitmapInfo.byteOrder32Big.rawValue
        let drewImage = pixels.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(
                data: bytes.baseAddress,
                width: image.width,
                height: image.height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: bitmapInfo
            ) else {
                return false
            }
            context.draw(
                image,
                in: CGRect(x: 0, y: 0, width: image.width, height: image.height)
            )
            return true
        }
        XCTAssertTrue(drewImage)
        return pixels
    }

    private func assertCompactAmountFits(
        _ text: String,
        font: Font,
        fixture: String,
        screen: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard BalanceRowRules.stacksNameOverAmount(screenWidth: Double(size.width)) else { return }
        XCTAssertTrue(
            WatchRender.fits(
                text,
                font: font,
                dynamicTypeSize: .large,
                width: size.width
            ),
            "\(screen) \(fixture) amount is truncated at "
                + "\(sizeDescription(size)): \(text)",
            file: file,
            line: line
        )
    }

    private func sizeDescription(_ size: CGSize) -> String {
        "\(Int(size.width))x\(Int(size.height))"
    }
}

private struct Named<Value> {
    let name: String
    let value: Value
}
