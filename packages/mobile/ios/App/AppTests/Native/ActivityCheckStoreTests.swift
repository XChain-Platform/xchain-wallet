// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import XCTest
@testable import App

final class ActivityCheckStoreTests: XCTestCase {
    private let valid = #"{"enabled":false,"targets":[],"notice":{"title":"Title","body":"Body"},"openOnPhoneTitle":"Open"}"#
    private var directory: URL!
    private var store: ActivityCheckStore!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        store = ActivityCheckStore(directory: directory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testDefaultDirectoryIsInApplicationSupport() throws {
        let expected = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let defaultDirectory = try ActivityCheckStore().directory
        XCTAssertEqual(
            defaultDirectory.deletingLastPathComponent().standardizedFileURL,
            expected.standardizedFileURL
        )
        XCTAssertEqual(defaultDirectory.lastPathComponent, "activity-check")
    }

    func testStoresOnlyPublicConfig() throws {
        let input = #"{"enabled":true,"privateKey":"secret","targets":[{"address":"xc1public","url":"https://example.test/xc1public","confirmedPath":"balances.confirmed","pendingPath":"balances.pending","confirmed":"1","pending":"0","seed":"words"}],"notice":{"title":"New activity","body":"Open wallet","token":"secret"},"openOnPhoneTitle":"Open on phone"}"#
        try store.setActivityCheck(input)

        let configURL = directory.appendingPathComponent("activity-check.json")
        let data = try Data(contentsOf: configURL)
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let target = try XCTUnwrap((config["targets"] as? [[String: Any]])?.first)
        let decoded = try XCTUnwrap(ActivityCheckConfig.decode(String(decoding: data, as: UTF8.self)))
        XCTAssertEqual(Set(config.keys), ["enabled", "targets", "notice", "openOnPhoneTitle"])
        XCTAssertEqual(Set(target.keys), ["address", "url", "confirmedPath", "pendingPath", "confirmed", "pending"])
        XCTAssertEqual(decoded.addresses, ["xc1public"])
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("secret"))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("words"))
    }

    func testDefaultProtectionApplierProtectsDirectoryAndFile() throws {
        try store.setActivityCheck(valid)

        let configURL = directory.appendingPathComponent("activity-check.json")
        let directoryValues = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        let fileValues = try configURL.resourceValues(forKeys: [.isExcludedFromBackupKey])
        XCTAssertEqual(directoryValues.isExcludedFromBackup, true)
        XCTAssertEqual(fileValues.isExcludedFromBackup, true)

        let attributes = try FileManager.default.attributesOfItem(atPath: configURL.path)
        let protection = attributes[.protectionKey] as? FileProtectionType
#if targetEnvironment(simulator)
        if let protection {
            XCTAssertEqual(protection, .completeUntilFirstUserAuthentication)
        } else {
            XCTAssertNil(attributes[.protectionKey])
        }
#else
        XCTAssertEqual(protection, .completeUntilFirstUserAuthentication)
#endif
    }

    func testInvalidConfigDoesNotReplaceValidConfig() throws {
        try store.setActivityCheck(valid)
        let configURL = directory.appendingPathComponent("activity-check.json")
        let before = try Data(contentsOf: configURL)

        XCTAssertThrowsError(
            try store.setActivityCheck(#"{"enabled":false,"targets":[{"address":"xc1"}]}"#)
        )
        XCTAssertEqual(try Data(contentsOf: configURL), before)
        XCTAssertEqual(try temporaryFiles(), [])
    }

    func testProtectionFailureLeavesNoConfigOrTemporaryFile() throws {
        let failingStore = ActivityCheckStore(directory: directory) { url, _, _ in
            if url.pathExtension == "tmp" {
                throw CocoaError(.fileWriteNoPermission)
            }
        }

        XCTAssertThrowsError(try failingStore.setActivityCheck(valid))
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: directory.appendingPathComponent("activity-check.json").path
            )
        )
        XCTAssertEqual(try temporaryFiles(), [])
    }

    func testProtectionFailureLeavesEarlierConfigUntouched() throws {
        var failTemporaryProtection = false
        let conditionalStore = ActivityCheckStore(directory: directory) { url, _, _ in
            if failTemporaryProtection && url.pathExtension == "tmp" {
                throw CocoaError(.fileWriteNoPermission)
            }
        }
        try conditionalStore.setActivityCheck(valid)
        let configURL = directory.appendingPathComponent("activity-check.json")
        let before = try Data(contentsOf: configURL)
        failTemporaryProtection = true

        let replacement = #"{"enabled":true,"targets":[],"notice":{"title":"Other","body":"Other"},"openOnPhoneTitle":"Other"}"#
        XCTAssertThrowsError(try conditionalStore.setActivityCheck(replacement))
        XCTAssertEqual(try Data(contentsOf: configURL), before)
        XCTAssertEqual(try temporaryFiles(), [])
    }

    func testRunLogAndClear() throws {
        try store.setActivityCheck(valid)
        try Data("10\njunk\n20\n".utf8).write(
            to: directory.appendingPathComponent("activity-check-runs.txt")
        )

        XCTAssertEqual(store.runLog(), [10, 20])
        XCTAssertTrue(store.clear())
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("activity-check.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("activity-check-runs.txt").path))
        XCTAssertTrue(store.clear())
    }

    func testPluginMethodsMatchBridgeContract() throws {
        let plugin = XChainActivityPlugin()
        plugin.store = store

        XCTAssertNil(call(plugin, method: "setActivityCheck", options: ["json": valid]).error)
        try Data("10\n20\n".utf8).write(
            to: directory.appendingPathComponent("activity-check-runs.txt")
        )
        let log = call(plugin, method: "runLog")
        XCTAssertNil(log.error)
        XCTAssertEqual(Set(log.data?.keys.map { $0 } ?? []), ["times"])
        XCTAssertEqual((log.data?["times"] as? [NSNumber])?.map(\.int64Value), [10, 20])
        let cleared = call(plugin, method: "clear")
        XCTAssertEqual(Set(cleared.data?.keys.map { $0 } ?? []), ["cleared"])
        XCTAssertEqual(cleared.data?["cleared"] as? Bool, true)
        XCTAssertNotNil(call(plugin, method: "setActivityCheck").error)
    }

    private func temporaryFiles() throws -> [String] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(atPath: directory.path).filter {
            $0.hasPrefix(".activity-check-") && $0.hasSuffix(".tmp")
        }
    }

    private func call(
        _ plugin: XChainActivityPlugin,
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
        case "setActivityCheck": plugin.setActivityCheck(call)
        case "runLog": plugin.runLog(call)
        default: plugin.clear(call)
        }
        wait(for: [done], timeout: 5)
        return (data, message)
    }
}
