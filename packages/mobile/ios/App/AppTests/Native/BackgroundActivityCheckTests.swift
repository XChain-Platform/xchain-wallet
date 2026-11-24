// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import BackgroundTasks
import Foundation
import XCTest
@testable import App

private final class RecordingActivityPoster: ActivityNoticePosting {
    var notices: [NotifyPostArgs] = []

    func post(_ notice: NotifyPostArgs) {
        notices.append(notice)
    }
}

private final class RecordingTaskScheduler: BackgroundTaskScheduling {
    var identifiers: [String] = []
    var requests: [BGTaskRequest] = []

    func register(
        forTaskWithIdentifier identifier: String,
        using queue: DispatchQueue?,
        launchHandler: @escaping (BGTask) -> Void
    ) -> Bool {
        identifiers.append(identifier)
        return true
    }

    func submit(_ taskRequest: BGTaskRequest) throws {
        requests.append(taskRequest)
    }
}

private actor ActivityRequestProbe {
    private var requests: [URLRequest] = []

    func record(_ request: URLRequest) {
        requests.append(request)
    }

    func all() -> [URLRequest] {
        requests
    }
}

final class BackgroundActivityCheckTests: XCTestCase {
    private var directory: URL!
    private var files: ActivityCheckFiles!
    private var poster: RecordingActivityPoster!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        files = ActivityCheckFiles(directory: directory)
        poster = RecordingActivityPoster()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    func testRegisterAlsoSchedulesSixHourRefresh() throws {
        let scheduler = RecordingTaskScheduler()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let check = BackgroundActivityCheck(
            directory: directory,
            poster: poster,
            now: { now }
        )

        XCTAssertTrue(BackgroundActivityCheck.register(check, scheduler: scheduler))
        XCTAssertEqual(scheduler.identifiers, ["io.xchain.wallet.ios.activity-check"])
        let request = try XCTUnwrap(scheduler.requests.first as? BGAppRefreshTaskRequest)
        XCTAssertEqual(request.identifier, "io.xchain.wallet.ios.activity-check")
        XCTAssertEqual(request.earliestBeginDate, now.addingTimeInterval(21_600))
    }

    func testUsesEphemeralGetRequestSettings() throws {
        let configuration = BackgroundActivityCheck.sessionConfiguration()
        XCTAssertFalse(configuration.urlCache === URLCache.shared)
        XCTAssertFalse(configuration.httpCookieStorage === HTTPCookieStorage.shared)
        XCTAssertFalse(
            configuration.urlCredentialStorage === URLCredentialStorage.shared
        )
        XCTAssertEqual(configuration.requestCachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(configuration.timeoutIntervalForRequest, 10)
        XCTAssertEqual(configuration.timeoutIntervalForResource, 10)

        let request = try XCTUnwrap(
            BackgroundActivityCheck.request(url: "https://example.test/address/one")
        )
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(request.timeoutInterval, 10)
        XCTAssertNil(BackgroundActivityCheck.request(url: "file:///etc/hosts"))
    }

    func testDisabledConfigDoesNothing() async throws {
        let original = config(enabled: false, baseline: false)
        try files.writeConfig(original)
        let check = BackgroundActivityCheck(
            directory: directory,
            poster: poster,
            now: { Date(timeIntervalSince1970: 1) },
            load: { _ in throw URLError(.cancelled) }
        )

        let ran = await check.runOnce()
        XCTAssertFalse(ran)
        XCTAssertEqual(files.readConfig(), original)
        XCTAssertEqual(files.runLog(), [])
        XCTAssertEqual(poster.notices, [])
    }

    func testFirstSightStoresBaselineWithoutNotice() async throws {
        try files.writeConfig(config(enabled: true, baseline: false))
        let probe = ActivityRequestProbe()
        let check = makeCheck(nowMs: 1_000, probe: probe) {
            #"{"wrong":{"confirmed":"9"},"result":{"settled":{"value":"17"},"waiting":{"value":"4"}}}"#
        }

        let ran = await check.runOnce()
        XCTAssertTrue(ran)

        let stored = try storedTarget()
        XCTAssertEqual(stored["confirmed"] as? String, "17")
        XCTAssertEqual(stored["pending"] as? String, "4")
        XCTAssertEqual((stored["lastCheckedAt"] as? NSNumber)?.int64Value, 1_000)
        XCTAssertEqual(files.runLog(), [1_000])
        XCTAssertEqual(poster.notices, [])
        let requests = await probe.all()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(
            request.url?.absoluteString,
            "https://example.test/activity/address-1"
        )
        XCTAssertEqual(request.httpMethod, "GET")
    }

    func testChangedStringsPostConfiguredNoticeOnce() async throws {
        try files.writeConfig(config(enabled: true, baseline: true))
        let check = makeCheck(nowMs: 2_000) {
            #"{"result":{"settled":{"value":"18"},"waiting":{"value":"5"}}}"#
        }

        let ran = await check.runOnce()
        XCTAssertTrue(ran)

        let stored = try storedTarget()
        XCTAssertEqual(stored["confirmed"] as? String, "18")
        XCTAssertEqual(stored["pending"] as? String, "5")
        XCTAssertEqual(files.runLog(), [2_000])
        let expectedNotice = try XCTUnwrap(ActivityNotice.args(
            title: "New activity",
            body: "Open XChain Wallet to see what changed."
        ))
        XCTAssertEqual(poster.notices, [expectedNotice])
    }

    func testFailedReadKeepsBaselineAndStillLogsRun() async throws {
        let original = config(enabled: true, baseline: true)
        try files.writeConfig(original)
        let check = BackgroundActivityCheck(
            directory: directory,
            poster: poster,
            now: { Date(timeIntervalSince1970: 3) },
            load: { request in
                let response = HTTPURLResponse(
                    url: request.url!,
                    statusCode: 503,
                    httpVersion: nil,
                    headerFields: nil
                )!
                return (Data(), response)
            }
        )

        let ran = await check.runOnce()
        XCTAssertTrue(ran)
        XCTAssertEqual(files.readConfig(), original)
        XCTAssertEqual(files.runLog(), [3_000])
        XCTAssertEqual(poster.notices, [])
    }

    private func makeCheck(
        nowMs: Int64,
        probe: ActivityRequestProbe? = nil,
        body: @escaping @Sendable () -> String
    ) -> BackgroundActivityCheck {
        BackgroundActivityCheck(
            directory: directory,
            poster: poster,
            now: { Date(timeIntervalSince1970: Double(nowMs) / 1_000) },
            load: { request in
                await probe?.record(request)
                let response = HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!
                return (Data(body().utf8), response)
            }
        )
    }

    private func storedTarget() throws -> [String: Any] {
        let data = try XCTUnwrap(files.readConfig()?.data(using: .utf8))
        let decoded = try JSONSerialization.jsonObject(with: data)
        let object = try XCTUnwrap(decoded as? [String: Any])
        return try XCTUnwrap((object["targets"] as? [[String: Any]])?.first)
    }

    private func config(enabled: Bool, baseline: Bool) -> String {
        var target: [String: Any] = [
            "address": "address-1",
            "url": "https://example.test/activity/address-1",
            "confirmedPath": "result.settled.value",
            "pendingPath": "result.waiting.value",
        ]
        if baseline {
            target["confirmed"] = "17"
            target["pending"] = "4"
        }
        let value: [String: Any] = [
            "enabled": enabled,
            "targets": [target],
            "notice": [
                "title": "New activity",
                "body": "Open XChain Wallet to see what changed.",
            ],
            "openOnPhoneTitle": "Open on phone",
        ]
        let data = try! JSONSerialization.data(
            withJSONObject: value,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return String(decoding: data, as: UTF8.self)
    }
}
