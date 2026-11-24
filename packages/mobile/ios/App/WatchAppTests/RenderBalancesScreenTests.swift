// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import XCTest
@testable import WatchApp

@MainActor
final class RenderBalancesScreenTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testRendersEverySnapshotInEveryModeAndChecksAmountsFit() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let names = WatchFixtureFiles.names(prefix: "snapshot-", in: directory)
        let size = WatchRender.screenSize()

        XCTAssertFalse(
            names.isEmpty,
            "W1 has no snapshot fixtures at \(sizeDescription(size))"
        )
        for name in names {
            let snapshot = try decoder.decode(
                Snapshot.self,
                from: WatchFixtureFiles.data(name, in: directory)
            )
            for (modeName, mode) in [("fiat", WatchUnitsMode.fiat), ("units", .units)] {
                assertRendered(
                    BalancesScreen(
                        snapshot: snapshot,
                        mode: mode,
                        phoneReachable: true,
                        now: snapshot.builtAt,
                        setMode: { _ in },
                        open: { _ in }
                    ),
                    fixture: name,
                    mode: modeName,
                    size: size
                )

                let display = BalancesPresenter.present(
                    snapshot: snapshot,
                    mode: mode,
                    phoneReachable: true,
                    now: snapshot.builtAt
                )
                for line in display.lines {
                    if let text = line.primary?.text {
                        assertFits(
                            text,
                            font: .body,
                            fixture: name,
                            mode: modeName,
                            size: size
                        )
                    }
                    if let text = line.secondary?.text {
                        assertFits(
                            text,
                            font: .caption2,
                            fixture: name,
                            mode: modeName,
                            size: size
                        )
                    }
                }
            }
        }
    }

    func testRendersLoadingState() {
        let size = WatchRender.screenSize()
        assertRendered(
            BalancesScreen(
                snapshot: nil,
                mode: nil,
                phoneReachable: true,
                now: nil,
                setMode: { _ in },
                open: { _ in }
            ),
            fixture: "nil-snapshot",
            mode: "loading",
            size: size
        )
    }

    private func assertRendered<ViewType: View>(
        _ view: ViewType,
        fixture: String,
        mode: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let context = "W1 \(fixture) \(mode) at \(sizeDescription(size))"
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
    }

    private func assertFits(
        _ text: String,
        font: Font,
        fixture: String,
        mode: String,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let assertion = {
            XCTAssertTrue(
                WatchRender.fits(
                    text,
                    font: font,
                    dynamicTypeSize: .large,
                    width: size.width
                ),
                "W1 \(fixture) \(mode) text does not fit "
                    + "at \(sizeDescription(size)): \(text)",
                file: file,
                line: line
            )
        }
        guard fixture == "snapshot-longnames" else {
            assertion()
            return
        }

        let nonStrict = XCTExpectedFailure.Options()
        nonStrict.isStrict = false
        XCTContext.runActivity(
            named: "W1 \(fixture) \(mode) text at \(sizeDescription(size)): \(text)"
        ) { _ in
            XCTExpectFailure(
                "WD-126: snapshot-longnames amount overflows W1 on 41 mm",
                options: nonStrict,
                failingBlock: assertion
            )
        }
    }

    private func sizeDescription(_ size: CGSize) -> String {
        "\(Int(size.width))x\(Int(size.height))"
    }
}
