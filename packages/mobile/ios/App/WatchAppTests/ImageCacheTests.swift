// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import XCTest

final class ImageCacheTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testStoresAndReadsAHashNamedFile() throws {
        let cache = ImageCache(directory: directory)
        let bytes = Data("image".utf8)
        let contentHash = hash(42)

        try cache.store(bytes, hash: contentHash)

        XCTAssertEqual(cache.data(for: contentHash), bytes)
        XCTAssertEqual(try fileNames(), [contentHash])
    }

    func testEvictsTheLeastRecentlyUsedFileAtExactlyTwoHundred() throws {
        let cache = ImageCache(directory: directory)
        try store(201, in: cache)

        XCTAssertNil(cache.data(for: hash(0)))
        XCTAssertNotNil(cache.data(for: hash(1)))
        XCTAssertEqual(try fileNames().count, ImageCache.capacity)
    }

    func testReadingAFileMakesItMostRecentlyUsed() throws {
        let cache = ImageCache(directory: directory)
        try store(ImageCache.capacity, in: cache)
        XCTAssertNotNil(cache.data(for: hash(0)))

        try cache.store(Data([255]), hash: hash(ImageCache.capacity))

        XCTAssertNotNil(cache.data(for: hash(0)))
        XCTAssertNil(cache.data(for: hash(1)))
    }

    func testSnapshotAndOpenDetailHashesAreNeverEvicted() throws {
        let cache = ImageCache(directory: directory)
        let snapshotHash = hash(500)
        let detailHash = hash(501)
        try cache.store(Data([1]), hash: snapshotHash)
        try cache.store(Data([2]), hash: detailHash)
        cache.setPinned(snapshot: [snapshotHash], openDetail: [detailHash])
        try store(199, in: cache)

        XCTAssertNotNil(cache.data(for: snapshotHash))
        XCTAssertNotNil(cache.data(for: detailHash))
        XCTAssertNil(cache.data(for: hash(0)))
        XCTAssertEqual(try fileNames().count, ImageCache.capacity)
    }

    func testDoesNotEvictWhenEveryOverflowFileIsPinned() throws {
        let cache = ImageCache(directory: directory)
        let hashes = Set((0...ImageCache.capacity).map(hash))
        cache.setPinned(snapshot: hashes, openDetail: [])
        try store(ImageCache.capacity + 1, in: cache)

        XCTAssertEqual(try fileNames().count, ImageCache.capacity + 1)
    }

    private func store(_ count: Int, in cache: ImageCache) throws {
        for index in 0..<count {
            try cache.store(Data([UInt8(index % 256)]), hash: hash(index))
        }
    }

    private func hash(_ index: Int) -> String {
        String(format: "%064x", index)
    }

    private func fileNames() throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted()
    }
}
