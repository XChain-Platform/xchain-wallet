// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import WatchConnectivity
import XCTest
@testable import WatchApp

final class RootViewTests: XCTestCase {
    private var directory: URL!
    private var defaults: UserDefaults!
    private var suiteName: String!
    private var session: RootSessionSpy!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        suiteName = "RootViewTests.\(UUID().uuidString)"
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        session = RootSessionSpy()
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: directory)
    }

    @MainActor
    func testRootStartsAtNotSetUpAndUsesBothContractMessages() async throws {
        let model = makeModel()
        let root = RootView(model: model)

        XCTAssertEqual(root.rootScreen, .notSetUp)
        XCTAssertEqual(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: model.hasSnapshot, enabled: model.enabled),
            "state.openWalletOnPhone"
        )

        session.receive(snapshot(enabled: false))
        await waitForMainQueue()

        XCTAssertEqual(root.rootScreen, .notSetUp)
        XCTAssertEqual(
            WatchScreenGraph.notSetUpTextKey(hasSnapshot: model.hasSnapshot, enabled: model.enabled),
            "state.watchDisabled"
        )
    }

    @MainActor
    func testSnapshotDrivesBalancesStatusPreferencesAndAmbientFlag() async throws {
        let model = makeModel()
        session.receive(snapshot(enabled: true))
        await waitForMainQueue()

        XCTAssertEqual(RootView(model: model).rootScreen, .balances)
        XCTAssertEqual(model.snapshot?.balancesAt, 1_700_000_000_000)
        XCTAssertEqual(model.snapshot?.session, "unlocked")
        XCTAssertEqual(model.mode, .fiat)

        model.setHideAmounts(true)
        XCTAssertTrue(model.hideAmounts)
        XCTAssertTrue(WatchPrefs(defaults: defaults).hideAmounts)
        XCTAssertTrue(AmbientRedactionState(
            luminanceReduced: false,
            phoneHidden: false,
            hideAmounts: model.hideAmounts
        ).redacted)
    }

    @MainActor
    func testDetailMarkReadAndOpenOnPhoneUseTheSharedSession() async throws {
        let model = makeModel()
        session.receive(snapshot(enabled: true))
        await waitForMainQueue()

        model.requestDetail("bitcoin-mainnet:BTC")
        model.markRead(MarkReadIntent(id: "alert-1"))
        model.openOnPhone(RootView.tokenRoute("bitcoin-mainnet:BTC"))

        XCTAssertEqual(session.messages.map { $0["kind"] as? String }, [
            "detailRequest", "markRead", "openOnPhone",
        ])
        XCTAssertEqual(
            try value(kind: "openOnPhone")["route"] as? String,
            "/asset/bitcoin-mainnet:BTC"
        )
        XCTAssertEqual(RootView.alertRoute("alert-1"), "/alerts/alert-1")
        XCTAssertEqual(RootView.requestRoute("request-1"), "/request/request-1")
    }

    @MainActor
    func testRootRendersNotSetUpAndSetUpAtBothWatchSizes() async throws {
        let sizes = [CGSize(width: 176, height: 215), CGSize(width: 205, height: 251)]

        for size in sizes {
            try await assertRootRenders(setUp: false, size: size)
        }
        for size in sizes {
            try await assertRootRenders(setUp: true, size: size)
        }
    }

    func testRootViewSourceWiresRootContentSelectionsToNavigationPath() throws {
        let sourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("WatchApp/Screens/RootView.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        let wiringPattern = #"NavigationStack\(path:\s*\$path\)\s*\{\s*RootContent\(model:\s*model,\s*redaction:\s*redaction\)\s*\{\s*path\.append\(\$0\)\s*\}"#
        let selectionPattern = #"private var balances:\s*some View\s*\{\s*BalancesScreen\([\s\S]*?open:\s*open\s*\)"#

        XCTAssertNotNil(
            source.range(of: wiringPattern, options: .regularExpression),
            "RootView must append RootContent selections to the navigation path"
        )
        XCTAssertNotNil(
            source.range(of: selectionPattern, options: .regularExpression),
            "RootContent must forward BalancesScreen selections to RootView"
        )
    }

    @MainActor
    private func makeModel() -> RootViewModel {
        RootViewModel(
            store: SnapshotStore(directory: directory.appendingPathComponent("snapshots")),
            prefs: WatchPrefs(defaults: defaults),
            images: ImageCache(directory: directory.appendingPathComponent("images")),
            session: session,
            appVersion: "4.2.1"
        )
    }

    private func snapshot(enabled: Bool) -> [String: Any] {
        let object: [String: Any] = [
            "v": 1,
            "builtAt": 1_700_000_000_000 as Int64,
            "balancesAt": 1_700_000_000_000 as Int64,
            "pricesAt": 1_700_000_000_000 as Int64,
            "session": "unlocked",
            "network": ["kind": "mainnet", "isTest": false],
            "fiatCode": "USD",
            "hidden": false,
            "unitDefault": "fiat",
            "walletName": "Daily wallet",
            "totals": ["fiatText": "$10.00", "unitsText": "1 BTC"],
            "rows": [[
                "id": "bitcoin-mainnet:BTC", "chainId": "bitcoin-mainnet", "tick": "BTC",
                "displayName": "Bitcoin", "amountText": "1 BTC", "fiatText": "$10.00",
                "noPrice": false, "pendingText": "", "unavailable": false,
                "iconHash": "", "tickerColor": "#F7931A", "hasDetail": true,
            ]],
            "capped": false,
            "receive": [],
            "inbox": [[
                "id": "alert-1", "family": "messages", "kind": "message",
                "title": "Message", "body": "Body", "at": 1_700_000_000_000 as Int64,
                "read": false,
            ]],
            "request": [
                "id": "request-1", "kind": "request", "iconHash": "",
                "sentence": "Review request", "amountText": "1 BTC",
            ],
            "settings": ["showTotal": true, "enabled": enabled],
        ]
        return object
    }

    @MainActor
    private func waitForMainQueue() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
    }

    private func value(kind: String) throws -> [String: Any] {
        let message = try XCTUnwrap(session.messages.first { $0["kind"] as? String == kind })
        return try XCTUnwrap(message["value"] as? [String: Any])
    }

    @MainActor
    private func assertRootRenders(
        setUp: Bool,
        size: CGSize
    ) async throws {
        let model = makeModel()
        if setUp {
            session.receive(snapshot(enabled: true))
            await waitForMainQueue()
        }
        let state = setUp ? "set up" : "not set up"
        XCTAssertEqual(
            WatchScreenGraph.root(hasSnapshot: model.hasSnapshot, enabled: model.enabled),
            setUp ? .balances : .notSetUp,
            state
        )
        let renderer = ImageRenderer(
            content: RootContent(
                model: model,
                redaction: AmbientRedactionState(
                    luminanceReduced: false,
                    phoneHidden: model.snapshot?.hidden ?? false,
                    hideAmounts: model.hideAmounts
                ),
                open: { _ in }
            )
            .frame(width: size.width, height: size.height)
        )
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage, "\(state), \(size)")
        XCTAssertEqual(image.width, Int(size.width), "\(state), \(size)")
        XCTAssertEqual(image.height, Int(size.height), "\(state), \(size)")
    }
}

private final class RootSessionSpy: PhoneSession {
    var isReachable = true
    var messages: [[String: Any]] = []
    private weak var delegate: WCSessionDelegate?

    func setDelegate(_ delegate: WCSessionDelegate) { self.delegate = delegate }
    func activate() {}
    func send(_ message: [String: Any]) { messages.append(message) }

    func receive(_ context: [String: Any]) {
        delegate?.session?(WCSession.default, didReceiveApplicationContext: context)
    }
}
