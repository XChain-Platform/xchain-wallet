// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

final class SnapshotStore {
    typealias DirectoryCreator = (URL, Bool, [FileAttributeKey: Any]?) throws -> Void
    typealias Writer = (Data, Data.WritingOptions) throws -> Void

    static let fileProtection: Data.WritingOptions = .completeFileProtectionUnlessOpen
    static let directoryProtection = FileProtectionType.completeUnlessOpen

    private let file: SnapshotFile
    private let writer: Writer
    private let decoder = JSONDecoder()

    private(set) var latest: Snapshot?

    init(directory: URL, writer: Writer? = nil, directoryCreator: DirectoryCreator? = nil) {
        let createDirectory = directoryCreator ?? { url, intermediates, attributes in
            try FileManager.default.createDirectory(
                at: url,
                withIntermediateDirectories: intermediates,
                attributes: attributes
            )
        }
        try? createDirectory(directory, true, [.protectionKey: Self.directoryProtection])
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
