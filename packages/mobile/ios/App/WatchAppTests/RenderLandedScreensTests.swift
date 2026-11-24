// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class RenderLandedScreensTests: XCTestCase {
    private let now: Int64 = 1_700_000_000_000
    private let decoder = JSONDecoder()

    func testRendersLandedScreensAndLongLooks() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let size = WatchRender.screenSize()
        let snapshot = try decode(Snapshot.self, named: "snapshot-rows50", in: directory)
        let row = try XCTUnwrap(snapshot.rows.first)

        for name in ["detail-cached", "detail-native", "detail-noart", "detail-loaderror"] {
            let detail = try decode(Detail.self, named: name, in: directory)
            let display = TokenDetailPresenter.present(row: row, detail: detail, phoneReachable: true)
            assertNotEmpty(display.displayName, screen: "W2 name", fixture: name, size: size)
            assertNotEmpty(display.amountText, screen: "W2 amount", fixture: name, size: size)
            assertNotEmpty(display.valueText, screen: "W2 value", fixture: name, size: size)
            assertRendered(
                TokenDetailScreen(display: display, onOpenOnPhone: {}),
                screen: "W2", fixture: name, size: size, checkBlank: false
            )
            assertFits(
                display.amountText, font: .title3,
                screen: "W2 amount", fixture: name, size: size
            )
            assertFits(
                display.valueText, font: .title3,
                screen: "W2 value", fixture: name, size: size
            )
        }

        let awayDisplay = TokenDetailPresenter.present(row: row, detail: nil, phoneReachable: false)
        assertNotEmpty(
            awayDisplay.displayName,
            screen: "W2 name", fixture: "nil-detail-phone-away", size: size
        )
        assertNotEmpty(
            awayDisplay.amountText,
            screen: "W2 amount", fixture: "nil-detail-phone-away", size: size
        )
        assertNotEmpty(
            awayDisplay.valueText,
            screen: "W2 value", fixture: "nil-detail-phone-away", size: size
        )
        assertRendered(
            TokenDetailScreen(display: awayDisplay, onOpenOnPhone: {}),
            screen: "W2", fixture: "nil-detail-phone-away", size: size, checkBlank: false
        )
        assertFits(
            awayDisplay.amountText, font: .title3,
            screen: "W2 amount", fixture: "nil-detail-phone-away", size: size
        )
        assertFits(
            awayDisplay.valueText, font: .title3,
            screen: "W2 value", fixture: "nil-detail-phone-away", size: size
        )

        let inbox = try decode([SnapshotInboxItem].self, named: "inbox-alerts", in: directory)
        XCTAssertEqual(inbox.count, 20, "W3 inbox-alerts fixture count")
        assertRendered(
            AlertsScreen(inbox: inbox, now: now, markRead: { _ in }),
            screen: "W3", fixture: "inbox-alerts", size: size
        )
        assertRendered(
            AlertsScreen(inbox: [], now: now, markRead: { _ in }),
            screen: "W3", fixture: "empty-inbox", size: size
        )

        for item in inbox {
            let detailScreen = AlertDetailScreen(item: item, now: now, onOpenOnPhone: {})
            assertNotEmpty(
                item.title, screen: "W4 alert title", fixture: "inbox-alerts:\(item.id)", size: size
            )
            if let detailBody = detailScreen.detailBody {
                assertNotEmpty(
                    detailBody,
                    screen: "W4 alert body", fixture: "inbox-alerts:\(item.id)", size: size
                )
            }
            assertRendered(
                detailScreen,
                screen: "W4", fixture: "inbox-alerts:\(item.id)", size: size, checkBlank: false
            )
        }

        let requestNames = WatchFixtureFiles.names(prefix: "request-", in: directory)
        XCTAssertFalse(requestNames.isEmpty, "W4/N2 request fixtures at \(sizeDescription(size))")
        for name in requestNames {
            let request = try decode(Request.self, named: name, in: directory)
            assertNotEmpty(request.sentence, screen: "W4 sentence", fixture: name, size: size)
            assertNotEmpty(request.amountText, screen: "W4 amount", fixture: name, size: size)
            assertRendered(
                AlertDetailScreen(request: request, now: now, onOpenOnPhone: {}),
                screen: "W4", fixture: name, size: size, checkBlank: false
            )

            let longLook = RequestLongLook(request: request, openOnPhone: {})
            let date = Date(timeIntervalSince1970: Double(now) / 1_000)
            let content = longLook.presentation(at: date)
            if name == "request-expired" {
                assertImageExists(
                    longLook.longLookContent(at: date),
                    failure: "N2 request-expired expected no content at fixed now but produced no "
                        + "image at \(sizeDescription(size))",
                    size: size
                )
            } else {
                let content = try XCTUnwrap(
                    content,
                    "N2 \(name) has no presentation at \(sizeDescription(size))"
                )
                assertNotEmpty(content.sentence, screen: "N2 sentence", fixture: name, size: size)
                assertNotEmpty(content.amountText, screen: "N2 amount", fixture: name, size: size)
                assertRendered(
                    longLook.longLookContent(at: date),
                    screen: "N2", fixture: name, size: size, checkBlank: false
                )
                assertFits(
                    content.amountText,
                    font: .title3.weight(.semibold),
                    screen: "N2 amount", fixture: name, size: size
                )
            }
        }

        let receive = try decode([SnapshotReceive].self, named: "receive-chains", in: directory)
        assertRendered(
            ReceiveScreen(receive: receive),
            screen: "W6", fixture: "receive-chains", size: size
        )
        assertRendered(
            ReceiveScreen(receive: []),
            screen: "W6", fixture: "empty-receive", size: size
        )

        let snapshotNames = WatchFixtureFiles.names(prefix: "snapshot-", in: directory)
        XCTAssertFalse(snapshotNames.isEmpty, "W8 snapshot fixtures at \(sizeDescription(size))")
        for name in snapshotNames {
            let value = try decode(Snapshot.self, named: name, in: directory)
            assertRendered(
                StatusScreen(
                    reachable: true,
                    balancesAt: value.balancesAt,
                    session: value.session,
                    hideAmounts: false,
                    appVersion: "1.0.0",
                    onToggleHideAmounts: { _ in }
                ),
                screen: "W8", fixture: name, size: size
            )
        }

        for (hasSnapshot, enabled) in [(false, false), (true, false)] {
            let key = try XCTUnwrap(WatchScreenGraph.notSetUpTextKey(
                hasSnapshot: hasSnapshot,
                enabled: enabled
            ))
            assertRendered(
                NotSetUpScreen(textKey: key),
                screen: "W9", fixture: key, size: size
            )
        }

        for item in inbox {
            for alwaysOn in [Bool?.none, true] {
                let mode = alwaysOn == true ? "always-on" : "default"
                assertRendered(
                    AlertLongLook(item: item, now: now, alwaysOn: alwaysOn),
                    screen: "N1", fixture: "inbox-alerts:\(item.id):\(mode)", size: size
                )
            }
        }
    }

    private func decode<Value: Decodable>(
        _ type: Value.Type,
        named name: String,
        in directory: URL
    ) throws -> Value {
        try decoder.decode(type, from: WatchFixtureFiles.data(name, in: directory))
    }

    private func assertRendered<ViewType: View>(
        _ view: ViewType,
        screen: String,
        fixture: String,
        size: CGSize,
        checkBlank: Bool = true,
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
        guard checkBlank else { return }
        XCTAssertFalse(
            WatchRender.isBlank(image),
            "\(context) rendered blank",
            file: file,
            line: line
        )
    }

    private func assertImageExists<ViewType: View>(
        _ view: ViewType,
        failure: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertNotNil(
            WatchRender.image(view.environment(\.colorScheme, .dark), size: size),
            failure,
            file: file,
            line: line
        )
    }

    private func assertNotEmpty(
        _ text: String,
        screen: String,
        fixture: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertFalse(
            text.isEmpty,
            "\(screen) \(fixture) has empty text at \(sizeDescription(size))",
            file: file,
            line: line
        )
    }

    private func assertFits(
        _ text: String,
        font: Font,
        screen: String,
        fixture: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(
            WatchRender.fits(text, font: font, dynamicTypeSize: .large, width: size.width),
            "\(screen) \(fixture) does not fit at \(sizeDescription(size)): \(text)",
            file: file,
            line: line
        )
    }

    private func sizeDescription(_ size: CGSize) -> String {
        "\(Int(size.width))x\(Int(size.height))"
    }
}
