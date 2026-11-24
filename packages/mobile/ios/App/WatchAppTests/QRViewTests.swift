// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation
import XCTest
@testable import WatchApp

final class QRViewTests: XCTestCase {
    func testUnpackedBitsMatchReceiveFixture() throws {
        let directory = try XCTUnwrap(WatchFixtureFiles.directory())
        let data = try WatchFixtureFiles.data("receive-chains", in: directory)
        let receive = try JSONDecoder().decode([SnapshotReceive].self, from: data)

        XCTAssertEqual(receive.count, 3)
        for entry in receive {
            let qr = entry.qr
            let bytes = try XCTUnwrap(Data(base64Encoded: qr.bits))
            let modules = try XCTUnwrap(QRModules.unpack(size: qr.size, bits: qr.bits))

            XCTAssertEqual(modules.count, qr.size * qr.size, entry.chainId)
            for (index, module) in modules.enumerated() {
                let mask = UInt8(1 << (7 - (index & 7)))
                XCTAssertEqual(module, bytes[index >> 3] & mask != 0, "\(entry.chainId) module \(index)")
            }

            _ = QRView(qr: qr)
        }
    }
}
