// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import CryptoKit
import Foundation
import XCTest
@testable import App

final class WatchSessionSendTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testSnapshotUsesApplicationContext() throws {
        let session = SendingSessionStub()
        let sender = WatchSessionSend(session: session, directory: directory)
        let context: [String: Any] = ["v": 1, "walletName": "Test"]

        try sender.sendSnapshot(context)

        XCTAssertEqual(session.contexts.count, 1)
        XCTAssertEqual(session.contexts[0]["v"] as? Int, 1)
        XCTAssertEqual(session.contexts[0]["walletName"] as? String, "Test")
    }

    func testDetailUsesFileMetadataAndCancelsSupersededTransfer() throws {
        let session = SendingSessionStub()
        let sender = WatchSessionSend(session: session, directory: directory)
        let first = Data(#"{"v":1,"tokenId":"btc","price":"1"}"#.utf8)
        let second = Data(#"{"v":1,"tokenId":"btc","price":"2"}"#.utf8)

        XCTAssertTrue(try sender.sendDetail(first, tokenId: "btc"))
        let firstURL = session.files[0].url
        XCTAssertEqual(try Data(contentsOf: firstURL), first)
        XCTAssertFalse(try sender.sendDetail(first, tokenId: "btc"))
        XCTAssertTrue(try sender.sendDetail(second, tokenId: "btc"))

        XCTAssertEqual(session.files.count, 2)
        XCTAssertEqual(session.files[0].metadata, ["kind": "detail", "key": "btc"])
        XCTAssertEqual(try Data(contentsOf: session.files[1].url), second)
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstURL.path))
        XCTAssertEqual(session.transfers[0].cancelCount, 1)
        XCTAssertEqual(session.transfers[1].cancelCount, 0)
    }

    func testImagesAreNamedAndDedupedByContentHash() throws {
        let session = SendingSessionStub()
        let sender = WatchSessionSend(session: session, directory: directory)
        let image = Data([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
        let hash = SHA256.hash(data: image).map { String(format: "%02x", $0) }.joined()

        XCTAssertTrue(try sender.sendImage(image))
        XCTAssertFalse(try sender.sendImage(image))

        XCTAssertEqual(session.files.count, 1)
        XCTAssertEqual(session.files[0].metadata, ["kind": "image", "key": hash])
        XCTAssertEqual(try Data(contentsOf: session.files[0].url), image)
        XCTAssertEqual(session.transfers[0].cancelCount, 0)
    }

    func testFinishedContentCanBeSentAgain() throws {
        let session = SendingSessionStub()
        let sender = WatchSessionSend(session: session, directory: directory)
        let detail = Data("detail".utf8)

        XCTAssertTrue(try sender.sendDetail(detail, tokenId: "btc"))
        let firstURL = session.files[0].url
        session.transfers[0].isTransferring = false
        XCTAssertTrue(try sender.sendDetail(detail, tokenId: "btc"))

        XCTAssertEqual(session.files.count, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstURL.path))
        XCTAssertEqual(session.transfers[0].cancelCount, 0)
    }

    func testDifferentDetailKeysDoNotCancelEachOther() throws {
        let session = SendingSessionStub()
        let sender = WatchSessionSend(session: session, directory: directory)

        XCTAssertTrue(try sender.sendDetail(Data("one".utf8), tokenId: "one"))
        XCTAssertTrue(try sender.sendDetail(Data("two".utf8), tokenId: "two"))

        XCTAssertEqual(session.transfers.map(\.cancelCount), [0, 0])
    }
}

private final class SendingSessionStub: WatchSendingSession {
    struct File {
        let url: URL
        let metadata: [String: String]
    }

    private(set) var contexts: [[String: Any]] = []
    private(set) var files: [File] = []
    private(set) var transfers: [FileTransferStub] = []

    func updateApplicationContext(_ applicationContext: [String: Any]) throws {
        contexts.append(applicationContext)
    }

    func enqueueFile(_ fileURL: URL, metadata: [String: Any]) -> WatchFileTransfer {
        let transfer = FileTransferStub()
        files.append(
            File(url: fileURL, metadata: metadata.compactMapValues { $0 as? String })
        )
        transfers.append(transfer)
        return transfer
    }
}

private final class FileTransferStub: WatchFileTransfer {
    var isTransferring = true
    private(set) var cancelCount = 0

    func cancel() {
        cancelCount += 1
    }
}
