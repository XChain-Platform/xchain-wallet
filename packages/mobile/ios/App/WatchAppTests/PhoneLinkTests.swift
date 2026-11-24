// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import WatchConnectivity
import XCTest
@testable import WatchApp

final class PhoneLinkTests: XCTestCase {
    private var directory: URL!
    private var fixtures: URL!
    private var session: SessionSpy!
    private var snapshotFile: SnapshotFile!
    private var imageCache: ImageCache!
    private var details: [Detail]!
    private var link: PhoneLink!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fixtures = try XCTUnwrap(WatchFixtureFiles.directory(from: #filePath))
        session = SessionSpy()
        let snapshots = SnapshotFile(directory: directory.appendingPathComponent("snapshots"))
        let images = ImageCache(directory: directory.appendingPathComponent("images"))
        snapshotFile = snapshots
        imageCache = images
        details = []
        link = PhoneLink(
            session: session,
            appVersion: "4.2.1",
            saveSnapshot: { try? snapshots.save($0) },
            saveDetail: { [weak self] in self?.details.append($0) },
            saveImage: { try images.store($0, hash: $1) }
        )
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testActivatesAndSendsWatchState() throws {
        link.activate()
        XCTAssertTrue(session.didActivate)

        session.isReachable = true
        session.completeActivation()

        XCTAssertTrue(link.isReachable)
        XCTAssertEqual(try sentValue(kind: "watchState")["appVersion"] as? String, "4.2.1")
    }

    func testTracksReachabilityChanges() {
        session.isReachable = true
        session.changeReachability()
        XCTAssertTrue(link.isReachable)

        session.isReachable = false
        session.changeReachability()
        XCTAssertFalse(link.isReachable)
    }

    func testReceivesSnapshotContextIntoStore() throws {
        let data = try WatchFixtureFiles.data("snapshot-empty", in: fixtures)
        let context = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        session.receiveContext(context)

        let saved = try XCTUnwrap(snapshotFile.load())
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: saved) as? [String: Any]
        )
        XCTAssertEqual(object["walletName"] as? String, "Daily wallet")
        XCTAssertEqual(saved, SnapshotFile(
            directory: directory.appendingPathComponent("snapshots")
        ).load())
    }

    func testReceivesDetailMessageAndFile() throws {
        session.receiveMessage(["v": 1, "tokenId": "bitcoin-mainnet:BTC"])
        XCTAssertEqual(details.map(\.tokenId), ["bitcoin-mainnet:BTC"])

        let file = directory.appendingPathComponent("detail.json")
        try Data(#"{"v":1,"tokenId":"bitcoin-mainnet:XC"}"#.utf8).write(to: file)
        link.receiveFile(
            at: file,
            metadata: ["kind": "detail", "key": "bitcoin-mainnet:XC"]
        )

        XCTAssertEqual(details.map(\.tokenId), ["bitcoin-mainnet:BTC", "bitcoin-mainnet:XC"])
    }

    func testReceivesHashNamedImageIntoCache() throws {
        let file = directory.appendingPathComponent("image")
        let data = Data("image bytes".utf8)
        let hash = String(repeating: "a", count: 64)
        try data.write(to: file)

        link.receiveFile(at: file, metadata: ["kind": "image", "key": hash])

        XCTAssertEqual(imageCache.data(for: hash), data)
    }

    func testRejectsMismatchedDetailMetadataAndUnsafeImageKey() throws {
        let detail = directory.appendingPathComponent("detail.json")
        try Data(#"{"v":1,"tokenId":"bitcoin-mainnet:BTC"}"#.utf8).write(to: detail)
        link.receiveFile(at: detail, metadata: ["kind": "detail", "key": "other"])

        let image = directory.appendingPathComponent("image")
        try Data([1]).write(to: image)
        link.receiveFile(at: image, metadata: ["kind": "image", "key": "../image"])

        XCTAssertTrue(details.isEmpty)
        XCTAssertNil(imageCache.data(for: "../image"))
    }

    func testSendsEveryLiveIntent() throws {
        link.refresh()
        link.detailRequest("bitcoin-mainnet:BTC")
        link.markRead("alert-1")
        link.openOnPhone("/request/request-1")

        XCTAssertEqual(session.messages.map { $0["kind"] as? String }, [
            "refresh", "detailRequest", "markRead", "openOnPhone",
        ])
        XCTAssertTrue(try sentValue(kind: "refresh").isEmpty)
        XCTAssertEqual(try sentValue(kind: "detailRequest")["tokenId"] as? String, "bitcoin-mainnet:BTC")
        XCTAssertEqual(try sentValue(kind: "markRead")["id"] as? String, "alert-1")
        XCTAssertEqual(try sentValue(kind: "openOnPhone")["route"] as? String, "/request/request-1")
    }

    private func sentValue(kind: String) throws -> [String: Any] {
        let message = try XCTUnwrap(session.messages.first { $0["kind"] as? String == kind })
        return try XCTUnwrap(message["value"] as? [String: Any])
    }
}

private final class SessionSpy: PhoneSession {
    var isReachable = false
    var didActivate = false
    var messages: [[String: Any]] = []
    private weak var delegate: WCSessionDelegate?

    func setDelegate(_ delegate: WCSessionDelegate) {
        self.delegate = delegate
    }

    func activate() {
        didActivate = true
    }

    func send(_ message: [String: Any]) {
        messages.append(message)
    }

    func completeActivation() {
        delegate?.session(
            WCSession.default,
            activationDidCompleteWith: .activated,
            error: nil
        )
    }

    func changeReachability() {
        delegate?.sessionReachabilityDidChange?(WCSession.default)
    }

    func receiveContext(_ context: [String: Any]) {
        delegate?.session?(WCSession.default, didReceiveApplicationContext: context)
    }

    func receiveMessage(_ message: [String: Any]) {
        delegate?.session?(WCSession.default, didReceiveMessage: message)
    }
}
