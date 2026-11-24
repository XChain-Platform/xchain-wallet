// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import UIKit
import WebKit
import XCTest
@testable import App

@MainActor
final class FoldPublisherTests: XCTestCase {
    private final class Harness {
        var sizeRegistrations = 0
        var traitRegistrations = 0
        var hingeRegistrations = 0
        var cancellations: [String] = []
        var sizeChanged: (() -> Void)?
        var traitsChanged: (() -> Void)?
        var hingeChanged: ((FoldPublisher.HingeState) -> Void)?
        var bootstrapScripts: [String] = []
        var evaluatedScripts: [String] = []
        var lines: [String] = []
        var appliedInsets: [UIEdgeInsets] = []
        weak var appliedWebView: WKWebView?
    }

    func testMapsEveryHingeStatus() {
        XCTAssertEqual(FoldPublisher.state(status: .absent, division: nil), .init(
            posture: "closed", division: .zero, orientation: "none", display: "outer"
        ))
        XCTAssertEqual(FoldPublisher.state(status: .open, division: nil).posture, "open")
        XCTAssertEqual(FoldPublisher.state(status: .partial, division: nil).posture, "partial")
        XCTAssertEqual(FoldPublisher.state(status: .closed, division: nil).display, "outer")
    }

    func testMapsVerticalAndHorizontalDivisionRegions() {
        let vertical = FoldPublisher.state(
            status: .partial,
            division: CGRect(x: 412.5, y: 0, width: 18, height: 900)
        )
        XCTAssertEqual(vertical.orientation, "vertical")
        XCTAssertEqual(vertical.division.minX, 412.5)
        XCTAssertEqual(vertical.display, "inner")

        let horizontal = FoldPublisher.state(
            status: .partial,
            division: CGRect(x: 0, y: 356, width: 678, height: 24)
        )
        XCTAssertEqual(horizontal.orientation, "horizontal")
        XCTAssertEqual(horizontal.division.minY, 356)
    }

    func testUnknownHingeUsesDivisionActivity() {
        XCTAssertEqual(FoldPublisher.state(status: .unknown, division: nil).posture, "open")
        XCTAssertEqual(
            FoldPublisher.state(status: .unknown, division: CGRect(x: 10, y: 0, width: 2, height: 20)).posture,
            "partial"
        )
    }

    func testBuildsBootstrapAndPublishScripts() {
        let json = "{\"posture\":\"open\"}"
        let assignment = "window.__xchainNativeFold = \(json);"

        XCTAssertEqual(FoldPublisher.bootstrapScript(json: json), assignment)
        XCTAssertEqual(
            FoldPublisher.publishScript(json: json),
            """
            \(assignment)
            window.dispatchEvent(new CustomEvent('xchain:native-fold', { detail: window.__xchainNativeFold }));
            """
        )
    }

    func testRefusesNonObjectScriptInputs() {
        for input in [nil, "", "not json", "[]", "1", "{\"ok\":true}; alert(1)"] as [String?] {
            XCTAssertNil(FoldPublisher.bootstrapScript(json: input))
            XCTAssertNil(FoldPublisher.publishScript(json: input))
        }
    }

    func testPreservesAsymmetricSafeAreaInsets() {
        let insets = UIEdgeInsets(top: 11, left: 23, bottom: 37, right: 41)
        XCTAssertEqual(FoldPublisher.indicatorInsets(for: insets), insets)
    }

    func testStartAndStopManageEveryObservation() {
        let (publisher, _, harness) = makeSubject()

        publisher.start()
        publisher.start()
        XCTAssertEqual(harness.sizeRegistrations, 1)
        XCTAssertEqual(harness.traitRegistrations, 1)
        XCTAssertEqual(harness.hingeRegistrations, 1)
        XCTAssertNotNil(harness.sizeChanged)
        XCTAssertNotNil(harness.traitsChanged)
        XCTAssertNotNil(harness.hingeChanged)

        publisher.stop()
        publisher.stop()
        XCTAssertEqual(harness.cancellations.sorted(), ["hinge", "size", "traits"])
        XCTAssertNil(harness.sizeChanged)
        XCTAssertNil(harness.traitsChanged)
        XCTAssertNil(harness.hingeChanged)
    }

    func testDivisionLookupRequestsDivisionRegionKind() {
        guard #available(iOS 27.1, *) else {
            return XCTFail("iOS 27.1 is required")
        }
        var requestedKind: UIView.ReservedRegion.Kind?
        let expected = CGRect(x: 410, y: 0, width: 20, height: 900)

        let frame = FoldPublisher.divisionFrame { kind in
            requestedKind = kind
            return [expected, CGRect(x: 1, y: 2, width: 3, height: 4)]
        }

        XCTAssertEqual(requestedKind, .division)
        XCTAssertEqual(frame, expected)
    }

    func testPublishesEvaluatesLogsAndAppliesInsets() {
        let (publisher, webView, harness) = makeSubject()

        publisher.start()

        XCTAssertEqual(harness.evaluatedScripts.count, 1)
        XCTAssertTrue(harness.evaluatedScripts[0].contains("window.__xchainNativeFold"))
        XCTAssertTrue(harness.evaluatedScripts[0].contains("xchain:native-fold"))
        XCTAssertEqual(harness.lines.count, 1)
        XCTAssertTrue(harness.lines[0].hasPrefix("fold: "))
        XCTAssertTrue(harness.lines[0].contains("\"viewport\":{\"height\":900,\"width\":840}"))
        XCTAssertEqual(harness.appliedInsets, [UIEdgeInsets(top: 11, left: 23, bottom: 37, right: 41)])
        XCTAssertTrue(harness.appliedWebView === webView)
        XCTAssertEqual(webView.scrollView.verticalScrollIndicatorInsets, harness.appliedInsets[0])
        XCTAssertEqual(webView.scrollView.horizontalScrollIndicatorInsets, harness.appliedInsets[0])

        harness.sizeChanged?()
        harness.traitsChanged?()
        harness.hingeChanged?(.partial)
        XCTAssertEqual(harness.evaluatedScripts.count, 4)
        XCTAssertEqual(harness.lines.count, 4)
        XCTAssertTrue(harness.evaluatedScripts[3].contains("\"posture\":\"partial\""))
    }

    func testInstallsBootstrapOnlyOnceAcrossRestart() {
        let (publisher, webView, harness) = makeSubject()

        publisher.start()
        publisher.stop()
        publisher.start()

        XCTAssertEqual(harness.bootstrapScripts.count, 1)
        XCTAssertEqual(webView.configuration.userContentController.userScripts.count, 1)
        XCTAssertEqual(harness.evaluatedScripts.count, 2)
    }

    private func makeSubject() -> (FoldPublisher, WKWebView, Harness) {
        let harness = Harness()
        let webView = WKWebView(frame: .zero)
        let environment = FoldPublisher.Environment(
            observeSize: { _, changed in
                harness.sizeRegistrations += 1
                harness.sizeChanged = changed
                return .init {
                    harness.cancellations.append("size")
                    harness.sizeChanged = nil
                }
            },
            observeTraits: { _, changed in
                harness.traitRegistrations += 1
                harness.traitsChanged = changed
                return .init {
                    harness.cancellations.append("traits")
                    harness.traitsChanged = nil
                }
            },
            observeHinge: { _, changed in
                harness.hingeRegistrations += 1
                harness.hingeChanged = changed
                return .init {
                    harness.cancellations.append("hinge")
                    harness.hingeChanged = nil
                }
            },
            divisionFrame: { _ in CGRect(x: 410, y: 0, width: 20, height: 900) },
            bounds: { _ in CGRect(x: 0, y: 0, width: 840, height: 900) },
            safeAreaInsets: { _ in UIEdgeInsets(top: 11, left: 23, bottom: 37, right: 41) },
            installBootstrap: { view, script in
                harness.bootstrapScripts.append(script)
                view.configuration.userContentController.addUserScript(
                    WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
                )
            },
            evaluateJavaScript: { _, script in harness.evaluatedScripts.append(script) },
            applyInsets: { view, insets in
                harness.appliedWebView = view
                harness.appliedInsets.append(insets)
                view.scrollView.scrollIndicatorInsets = insets
            },
            log: { harness.lines.append($0) }
        )
        return (FoldPublisher(webView: webView, environment: environment), webView, harness)
    }
}
