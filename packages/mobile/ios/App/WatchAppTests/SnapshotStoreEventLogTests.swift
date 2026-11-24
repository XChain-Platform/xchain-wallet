// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest
@testable import WatchApp

final class SnapshotStoreEventLogTests: XCTestCase {
    private enum WriterFailure: Error {
        case failed
    }

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

    func testLogsVersionForEverySavedEnabledSnapshot() throws {
        var versions: [Int] = []
        let store = SnapshotStore(directory: directory, eventLog: { versions.append($0) })

        XCTAssertTrue(store.save(try fixture("snapshot-rows50")))
        XCTAssertEqual(versions, [1])

        XCTAssertTrue(store.save(try fixture("snapshot-hidden")))
        XCTAssertEqual(versions, [1, 1])
    }

    func testDoesNotLogRejectedOrFailedSnapshots() throws {
        var versions: [Int] = []
        let store = SnapshotStore(directory: directory, eventLog: { versions.append($0) })

        XCTAssertTrue(store.save(try fixture("snapshot-disabled")))
        XCTAssertFalse(store.save(Data("not JSON".utf8)))
        XCTAssertFalse(store.save(try sleepingSnapshot()))

        let throwingStore = SnapshotStore(
            directory: directory,
            writer: { _, _ in throw WriterFailure.failed },
            eventLog: { versions.append($0) }
        )
        XCTAssertFalse(throwingStore.save(try fixture("snapshot-empty")))

        XCTAssertEqual(versions, [])
    }

    func testDefaultEventLogStillSavesSnapshot() throws {
        let store = SnapshotStore(directory: directory)

        XCTAssertTrue(store.save(try fixture("snapshot-empty")))
        XCTAssertEqual(store.latest?.v, 1)
    }

    private func sleepingSnapshot() throws -> Data {
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixture("snapshot-empty")) as? [String: Any]
        )
        object["session"] = "sleeping"
        return try JSONSerialization.data(withJSONObject: object)
    }

    private func fixture(_ name: String) throws -> Data {
        try WatchFixtureFiles.data(name, in: fixtures)
    }
}
