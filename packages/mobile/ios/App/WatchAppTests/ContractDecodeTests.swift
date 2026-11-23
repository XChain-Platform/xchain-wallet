// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import XCTest
@testable import WatchApp

final class ContractDecodeTests: XCTestCase {
    func testDecodesEverySnapshotFixture() throws {
        try decodeFixtures(prefix: "snapshot-", as: Snapshot.self)
    }

    func testDecodesEveryDetailFixture() throws {
        try decodeFixtures(prefix: "detail-", as: Detail.self)
    }

    private func decodeFixtures<Value: Decodable>(
        prefix: String,
        as type: Value.Type
    ) throws {
        guard let directory = WatchFixtureFiles.directory(from: #filePath) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let names = WatchFixtureFiles.names(prefix: prefix, in: directory)
        guard !names.isEmpty else {
            throw CocoaError(.fileReadNoSuchFile)
        }

        for name in names {
            let data = try WatchFixtureFiles.data(name, in: directory)
            _ = try JSONDecoder().decode(type, from: data)
        }
    }
}
