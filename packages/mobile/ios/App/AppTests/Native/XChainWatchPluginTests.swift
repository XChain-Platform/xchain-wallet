// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import CryptoKit
import WatchConnectivity
import XCTest
@testable import App

final class XChainWatchPluginTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testDeclaresCompleteStringOnlySurface() {
        let plugin = XChainWatchPlugin()

        XCTAssertEqual(
            plugin.pluginMethods.map(\.name),
            [
                "isAvailable", "status", "sendSnapshot", "sendDetail", "sendImage",
                "removeWatchData",
            ]
        )
        XCTAssertTrue(plugin.pluginMethods.allSatisfy { $0.returnType == CAPPluginReturnPromise })
    }

    func testSendsValidatedSnapshotDetailAndImage() throws {
        let session = PluginSendingSession()
        let plugin = makePlugin(session: session)
        let snapshot = #"{"v":1,"builtAt":1700000000000,"settings":{"enabled":true}}"#
        let detail = #"{"v":1,"tokenId":"bitcoin-mainnet:BTC"}"#
        let image = Data([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
        let hash = SHA256.hash(data: image).map { String(format: "%02x", $0) }.joined()

        XCTAssertNil(call(plugin, method: "sendSnapshot", options: ["json": snapshot]).error)
        XCTAssertNil(call(plugin, method: "sendDetail", options: ["json": detail]).error)
        XCTAssertNil(call(plugin, method: "sendImage", options: [
            "hash": hash,
            "base64": image.base64EncodedString(),
        ]).error)

        XCTAssertEqual(
            (session.contexts.first?["builtAt"] as? NSNumber)?.int64Value,
            1_700_000_000_000
        )
        XCTAssertEqual(plugin.lastSyncAt, 1_700_000_000_000)
        XCTAssertEqual(session.files.map(\.metadata), [
            ["kind": "detail", "key": "bitcoin-mainnet:BTC"],
            ["kind": "image", "key": hash],
        ])
        XCTAssertEqual(try Data(contentsOf: session.files[0].url), Data(detail.utf8))
        XCTAssertEqual(try Data(contentsOf: session.files[1].url), image)
    }

    func testRejectsMalformedStringsWithoutSending() {
        let session = PluginSendingSession()
        let plugin = makePlugin(session: session)

        let snapshot = call(plugin, method: "sendSnapshot", options: ["json": "{}"])
        let detail = call(plugin, method: "sendDetail", options: ["json": #"{"v":1}"#])
        let image = call(plugin, method: "sendImage", options: ["hash": "bad", "base64": "bad"])

        XCTAssertEqual(snapshot.error, "valid snapshot json is required")
        XCTAssertEqual(detail.error, "valid detail json is required")
        XCTAssertEqual(image.error, "valid image hash and base64 are required")
        XCTAssertTrue(session.contexts.isEmpty)
        XCTAssertTrue(session.files.isEmpty)
        XCTAssertNil(plugin.lastSyncAt)
    }

    func testRemoveSendsDecodableDisabledSnapshotAndClearsSyncTime() {
        let session = PluginSendingSession()
        let plugin = makePlugin(session: session)
        plugin.lastSyncAt = 1_700_000_000_000

        let result = call(plugin, method: "removeWatchData")

        XCTAssertNil(result.error)
        XCTAssertNil(plugin.lastSyncAt)
        XCTAssertEqual(session.contexts.count, 1)
        XCTAssertEqual(session.contexts[0]["v"] as? Int, 1)
        XCTAssertEqual(
            (session.contexts[0]["settings"] as? [String: Any])?["enabled"] as? Bool,
            false
        )
        XCTAssertEqual((session.contexts[0]["rows"] as? [Any])?.count, 0)
    }

    func testHostIntentPublishesContractEventAndDropsInvalidEnvelope() {
        let plugin = XChainWatchPlugin()
        var events: [(kind: String, value: [String: Any])] = []
        plugin.intentPublisher = { events.append((kind: $0, value: $1)) }
        plugin.host = WatchSessionHost(session: nil)
        plugin.load()

        plugin.host.session(.default, didReceiveMessage: [
            "kind": "markRead",
            "value": ["id": "alert-1"],
        ])
        plugin.host.session(.default, didReceiveMessage: [
            "kind": "unknown",
            "value": [String: Any](),
        ])

        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events.first?.kind, "markRead")
        XCTAssertEqual(events.first?.value["id"] as? String, "alert-1")
    }

    private func makePlugin(session: PluginSendingSession) -> XChainWatchPlugin {
        let plugin = XChainWatchPlugin()
        plugin.sender = WatchSessionSend(session: session, directory: directory)
        return plugin
    }

    private func call(
        _ plugin: XChainWatchPlugin,
        method: String,
        options: [String: Any] = [:]
    ) -> (data: [String: Any]?, error: String?) {
        let done = expectation(description: "\(method) settles")
        var data: [String: Any]?
        var message: String?
        let call = CAPPluginCall(
            callbackId: "test-\(method)",
            methodName: method,
            options: JSTypes.coerceDictionaryToJSObject(options) ?? [:],
            success: { result, _ in data = result?.data ?? [:]; done.fulfill() },
            error: { error in message = error?.message; done.fulfill() }
        )!
        switch method {
        case "sendSnapshot": plugin.sendSnapshot(call)
        case "sendDetail": plugin.sendDetail(call)
        case "sendImage": plugin.sendImage(call)
        default: plugin.removeWatchData(call)
        }
        wait(for: [done], timeout: 5)
        return (data, message)
    }
}

private final class PluginSendingSession: WatchSendingSession {
    struct File {
        let url: URL
        let metadata: [String: String]
    }

    var contexts: [[String: Any]] = []
    var files: [File] = []

    func updateApplicationContext(_ applicationContext: [String: Any]) throws {
        contexts.append(applicationContext)
    }

    func enqueueFile(_ fileURL: URL, metadata: [String: Any]) -> WatchFileTransfer {
        files.append(File(
            url: fileURL,
            metadata: metadata.compactMapValues { $0 as? String }
        ))
        return PluginFileTransfer()
    }
}

private final class PluginFileTransfer: WatchFileTransfer {
    var isTransferring = true
    func cancel() {}
}
