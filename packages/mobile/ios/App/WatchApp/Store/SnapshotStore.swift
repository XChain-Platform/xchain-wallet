// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct Snapshot: Codable {
    let v: Int
    let builtAt: Int64
    let balancesAt: Int64
    let pricesAt: Int64
    let session: String
    let network: SnapshotNetwork
    let fiatCode: String
    let hidden: Bool
    let unitDefault: String
    let walletName: String
    let totals: SnapshotTotals
    let rows: [SnapshotRow]
    let capped: Bool
    let receive: [SnapshotReceive]
    let inbox: [SnapshotInboxItem]
    let request: Request
    let settings: SnapshotSettings
}

struct SnapshotNetwork: Codable {
    let kind: String
    let isTest: Bool
}

struct SnapshotTotals: Codable {
    let fiatText: String
    let unitsText: String
}

final class SnapshotStore {
    typealias Writer = (Data, Data.WritingOptions) throws -> Void

    static let fileProtection: Data.WritingOptions = .completeFileProtectionUnlessOpen
    static let directoryProtection = FileProtectionType.completeUnlessOpen

    private let file: SnapshotFile
    private let writer: Writer
    private let decoder = JSONDecoder()

    private(set) var latest: Snapshot?

    init(directory: URL, writer: Writer? = nil) {
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: Self.directoryProtection]
        )
        let file = SnapshotFile(directory: directory)
        self.file = file
        self.writer = writer ?? { data, options in
            try file.save(data, options: options)
        }
        latest = file.load().flatMap { try? decoder.decode(Snapshot.self, from: $0) }
    }

    func age(now: Int64 = Int64(Date().timeIntervalSince1970 * 1_000))
        -> (bucket: WatchAge.Bucket, n: Int, amber: Bool)? {
        latest.map { WatchAge.of(balancesAt: $0.balancesAt, now: now) }
    }

    @discardableResult
    func save(_ data: Data) -> Bool {
        guard let snapshot = try? decoder.decode(Snapshot.self, from: data),
              snapshot.session == "unlocked" || snapshot.session == "locked" else {
            return false
        }
        guard snapshot.settings.enabled else {
            latest = nil
            return file.wipe()
        }
        do {
            try writer(data, Self.fileProtection)
            latest = snapshot
            return true
        } catch {
            return false
        }
    }

    @discardableResult
    func wipe() -> Bool {
        latest = nil
        return file.wipe()
    }
}
