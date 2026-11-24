// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class SnapshotStoreTests: XCTestCase {
    private var directory: URL!
    private var fixtures: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        fixtures = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testDecodesEverySnapshotFixtureThroughTheContractModel() throws {
        let names = WatchFixtureFiles.names(prefix: "snapshot-", in: fixtures)

        XCTAssertFalse(names.isEmpty)
        for name in names {
            let snapshot = try JSONDecoder().decode(Snapshot.self, from: fixture(name))
            XCTAssertEqual(snapshot.v, 1, name)
        }
    }

    func testPassesCompleteUnlessOpenProtectionToDirectoryCreator() throws {
        var receivedURL: URL?
        var receivedIntermediates: Bool?
        var receivedAttributes: [FileAttributeKey: Any]?

        _ = SnapshotStore(directory: directory, directoryCreator: { url, intermediates, attributes in
            receivedURL = url
            receivedIntermediates = intermediates
            receivedAttributes = attributes
        })

        XCTAssertEqual(receivedURL, directory)
        XCTAssertEqual(receivedIntermediates, true)
        XCTAssertEqual(
            receivedAttributes?[.protectionKey] as? FileProtectionType,
            FileProtectionType.completeUnlessOpen
        )
    }

    func testPassesCompleteUnlessOpenProtectionToWriter() throws {
        var receivedOptions: Data.WritingOptions?
        let store = SnapshotStore(directory: directory) { _, options in
            receivedOptions = options
        }

        XCTAssertTrue(store.save(try fixture("snapshot-empty")))
        XCTAssertEqual(receivedOptions, .completeFileProtectionUnlessOpen)
    }

    func testSavesAndLoadsLatestSnapshot() throws {
        let store = SnapshotStore(directory: directory)
        let snapshot = try fixture("snapshot-empty")

        XCTAssertTrue(store.save(snapshot))
        XCTAssertEqual(store.latest?.walletName, "Daily wallet")
        XCTAssertEqual(SnapshotStore(directory: directory).latest?.walletName, "Daily wallet")
    }

    func testComputesAgeFromBalancesAt() throws {
        let store = SnapshotStore(directory: directory)
        let snapshot = try fixture("snapshot-stale")
        XCTAssertTrue(store.save(snapshot))
        let balancesAt = try XCTUnwrap(store.latest?.balancesAt)

        let age = try XCTUnwrap(store.age(now: balancesAt + 16 * 60_000))
        XCTAssertEqual(age.bucket, .minutes)
        XCTAssertEqual(age.n, 16)
        XCTAssertTrue(age.amber)
    }

    func testKeepsDataWhenThePhoneSessionIsLocked() throws {
        let store = SnapshotStore(directory: directory)
        let empty = try fixture("snapshot-empty")
        let locked = try fixture("snapshot-locked")
        XCTAssertTrue(store.save(empty))
        XCTAssertTrue(store.save(locked))

        XCTAssertEqual(store.latest?.session, "locked")
        XCTAssertEqual(store.latest?.rows.count, 1)
        XCTAssertEqual(SnapshotStore(directory: directory).latest?.session, "locked")
    }

    func testDisabledSnapshotWipesMemoryAndDisk() throws {
        let store = SnapshotStore(directory: directory)
        let empty = try fixture("snapshot-empty")
        let disabled = try fixture("snapshot-disabled")
        XCTAssertTrue(store.save(empty))

        XCTAssertTrue(store.save(disabled))
        XCTAssertNil(store.latest)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: directory.appendingPathComponent(SnapshotFile.fileName).path
        ))
        XCTAssertNil(SnapshotStore(directory: directory).latest)
    }

    func testMalformedSnapshotDoesNotReplaceLatest() throws {
        let store = SnapshotStore(directory: directory)
        let snapshot = try fixture("snapshot-empty")
        XCTAssertTrue(store.save(snapshot))

        XCTAssertFalse(store.save(Data(#"{"session":"locked"}"#.utf8)))
        XCTAssertEqual(store.latest?.walletName, "Daily wallet")
        XCTAssertEqual(SnapshotStore(directory: directory).latest?.walletName, "Daily wallet")
    }

    private func fixture(_ name: String) throws -> Data {
        try WatchFixtureFiles.data(name, in: fixtures)
    }
}
