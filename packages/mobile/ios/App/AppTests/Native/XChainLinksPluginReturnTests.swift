// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import Foundation
import XCTest
@testable import App

private final class PluginReturnOpener {
    private var answers: [Bool]
    private(set) var urls: [URL] = []

    init(answers: [Bool]) {
        self.answers = answers
    }

    func open(_ url: URL, completion: @escaping (Bool) -> Void) {
        urls.append(url)
        completion(answers.isEmpty ? false : answers.removeFirst())
    }
}

final class XChainLinksPluginReturnTests: XCTestCase {
    private let returnURL = "https://example.com/done#xchain=AA"

    func testBridgeSurfaceIncludesPromiseReturnToBrowser() {
        let method = XChainLinksPlugin().pluginMethods.first {
            $0.name == "returnToBrowser"
        }

        XCTAssertEqual(method?.returnType, CAPPluginReturnPromise)
    }

    func testChromeFallsBackToHTTPSAndResolvesEmptyObject() {
        let opener = PluginReturnOpener(answers: [false, true])
        let result = call(options: ["url": returnURL, "browser": "chrome"], opener: opener)

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?.count, 0)
        XCTAssertEqual(result.settlements, 1)
        XCTAssertEqual(
            opener.urls.map(\.absoluteString),
            ["googlechromes://example.com/done#xchain=AA", returnURL]
        )
    }

    func testNoBrowserHintOpensHTTPSAndResolves() {
        let opener = PluginReturnOpener(answers: [true])
        let result = call(options: ["url": returnURL], opener: opener)

        XCTAssertNil(result.error)
        XCTAssertEqual(result.data?.count, 0)
        XCTAssertEqual(result.settlements, 1)
        XCTAssertEqual(opener.urls.map(\.absoluteString), [returnURL])
    }

    func testFailedFirefoxCandidatesRejectWithoutDetails() {
        let opener = PluginReturnOpener(answers: [false, false])
        let result = call(
            options: ["url": returnURL, "browser": "firefox"],
            opener: opener
        )

        XCTAssertNil(result.data)
        XCTAssertEqual(result.error, "No browser opened the return URL")
        XCTAssertEqual(result.settlements, 1)
        XCTAssertEqual(opener.urls.count, 2)
    }

    func testRefusedURLsNeverCallOpener() {
        let cases: [(String, [String: Any])] = [
            ("missing", [:]),
            ("http", ["url": "http://example.com/"]),
            ("malformed", ["url": "not a url"]),
        ]

        for (name, options) in cases {
            let opener = PluginReturnOpener(answers: [true])
            let result = call(options: options, opener: opener, label: name)

            XCTAssertNil(result.data)
            XCTAssertEqual(result.error, "Return URL refused")
            XCTAssertEqual(result.settlements, 1)
            XCTAssertTrue(opener.urls.isEmpty)
        }
    }

    private func call(
        options: [String: Any],
        opener: PluginReturnOpener,
        label: String = "returnToBrowser"
    ) -> (data: [String: Any]?, error: String?, settlements: Int) {
        let done = expectation(description: "\(label) settles")
        var data: [String: Any]?
        var message: String?
        var settlements = 0
        let call = CAPPluginCall(
            callbackId: "test-\(label)",
            methodName: "returnToBrowser",
            options: JSTypes.coerceDictionaryToJSObject(options) ?? [:],
            success: { result, _ in
                settlements += 1
                data = result?.data ?? [:]
                done.fulfill()
            },
            error: { error in
                settlements += 1
                message = error?.message
                done.fulfill()
            }
        )!
        let plugin = XChainLinksPlugin()
        plugin.returnOpener = opener.open

        plugin.returnToBrowser(call)

        wait(for: [done], timeout: 5)
        return (data, message, settlements)
    }
}
