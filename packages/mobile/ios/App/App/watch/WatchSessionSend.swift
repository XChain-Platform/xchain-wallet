// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import CryptoKit
import Foundation
import WatchConnectivity

protocol WatchFileTransfer: AnyObject {
    var isTransferring: Bool { get }
    func cancel()
}

extension WCSessionFileTransfer: WatchFileTransfer {}

protocol WatchSendingSession: AnyObject {
    func updateApplicationContext(_ applicationContext: [String: Any]) throws
    func enqueueFile(_ fileURL: URL, metadata: [String: Any]) -> WatchFileTransfer
}

extension WCSession: WatchSendingSession {
    func enqueueFile(_ fileURL: URL, metadata: [String: Any]) -> WatchFileTransfer {
        transferFile(fileURL, metadata: metadata)
    }
}

final class WatchSessionSend {
    private struct PendingTransfer {
        let transfer: WatchFileTransfer
        let fileURL: URL
    }

    private let session: WatchSendingSession
    private let directory: URL
    private var ledger = WatchTransferLedger<ObjectIdentifier>()
    private var transfers: [ObjectIdentifier: PendingTransfer] = [:]

    init(
        session: WatchSendingSession = WCSession.default,
        directory: URL = FileManager.default.temporaryDirectory
            .appendingPathComponent("watch-send", isDirectory: true)
    ) {
        self.session = session
        self.directory = directory
    }

    func sendSnapshot(_ context: [String: Any]) throws {
        try session.updateApplicationContext(context)
    }

    @discardableResult
    func sendDetail(_ data: Data, tokenId: String) throws -> Bool {
        try sendFile(
            data,
            kind: "detail",
            key: tokenId,
            ledgerKey: "detail:\(tokenId)"
        )
    }

    @discardableResult
    func sendImage(_ data: Data) throws -> Bool {
        let hash = Self.hash(data)
        return try sendFile(data, kind: "image", key: hash, ledgerKey: "image:\(hash)")
    }

    private func sendFile(
        _ data: Data,
        kind: String,
        key: String,
        ledgerKey: String
    ) throws -> Bool {
        removeFinishedTransfers()
        let hash = Self.hash(data)
        guard let metadata = WatchFileMetadata.metadata(kind: kind, key: key) else {
            return false
        }

        switch ledger.decide(key: ledgerKey, hash: hash) {
        case .skip:
            return false
        case .send(let cancel):
            for identifier in cancel {
                guard let pending = transfers.removeValue(forKey: identifier) else {
                    continue
                }
                pending.transfer.cancel()
                try? FileManager.default.removeItem(at: pending.fileURL)
            }
        }

        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let fileURL = directory.appendingPathComponent(
            "\(kind)-\(UUID().uuidString)"
        )
        try data.write(to: fileURL, options: .atomic)
        let transfer = session.enqueueFile(fileURL, metadata: metadata)
        let identifier = ObjectIdentifier(transfer)
        transfers[identifier] = PendingTransfer(transfer: transfer, fileURL: fileURL)
        ledger.started(key: ledgerKey, hash: hash, handle: identifier)
        return true
    }

    private func removeFinishedTransfers() {
        let finished = transfers.compactMap { identifier, pending in
            pending.transfer.isTransferring ? nil : identifier
        }
        for identifier in finished {
            guard let pending = transfers.removeValue(forKey: identifier) else {
                continue
            }
            ledger.finished(handle: identifier)
            try? FileManager.default.removeItem(at: pending.fileURL)
        }
    }

    private static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
