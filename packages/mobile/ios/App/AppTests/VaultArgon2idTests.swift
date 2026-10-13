// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Holds the native Argon2id helper to the golden vectors in
// test/fixtures/crypto/argon2id-vectors.json, which the JS implementation
// produced. A mismatch would leave existing wallets unopenable on iOS.

import XCTest
@testable import App

final class VaultArgon2idTests: XCTestCase {

    private struct Vector: Decodable {
        let name: String
        let password: String
        let salt: String
        let iterations: Int
        let memoryKib: Int
        let parallelism: Int
        let length: Int
        let keyHex: String
    }

    private struct Fixture: Decodable {
        let vectors: [Vector]
    }

    /// The fixture ships as a test-bundle resource, copied from the shared file.
    private func loadVectors() throws -> [Vector] {
        let bundle = Bundle(for: VaultArgon2idTests.self)
        let url = try XCTUnwrap(bundle.url(forResource: "argon2id-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url)).vectors
    }

    private func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func derive(_ v: Vector) throws -> [UInt8] {
        let params = try Argon2idParams.checked(
            iterations: v.iterations, memoryKib: v.memoryKib, parallelism: v.parallelism, length: v.length
        )
        let salt = try XCTUnwrap(Data(base64Encoded: v.salt))
        return try VaultArgon2id.derive(password: Array(v.password.utf8), salt: Array(salt), params: params)
    }

    func testEveryGoldenVectorMatches() throws {
        let vectors = try loadVectors()
        XCTAssertEqual(vectors.count, 5, "the fixture holds five cases")
        for v in vectors {
            let started = DispatchTime.now()
            let key = try derive(v)
            let ms = Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000
            print("argon2id vector '\(v.name)': \(String(format: "%.0f", ms)) ms")
            XCTAssertEqual(hex(key), v.keyHex, v.name)
        }
    }

    /// Times the wallet parameters (t=3, m=64 MiB, p=1); the simulator runs on
    /// the Mac's CPU, so a phone is slower than this figure.
    func testWalletParameterTiming() throws {
        let params = try Argon2idParams.checked(iterations: 3, memoryKib: 65536, parallelism: 1, length: 32)
        let salt = [UInt8](repeating: 7, count: 16)
        var samples: [Double] = []
        for _ in 0..<3 {
            let started = DispatchTime.now()
            _ = try VaultArgon2id.derive(password: Array("timing".utf8), salt: salt, params: params)
            samples.append(Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000)
        }
        print("argon2id t=3 m=65536 p=1 ms: \(samples.map { String(format: "%.0f", $0) }.joined(separator: ", "))")
    }

    func testOutOfRangeParametersAreRefused() {
        let cases: [(Int, Int, Int, Int)] = [
            (0, 65536, 1, 32), (65, 65536, 1, 32),
            (3, 65536, 0, 32), (3, 65536, 9, 32),
            (3, 15, 2, 32), (3, 1_048_577, 1, 32),
            (3, 65536, 1, 3), (3, 65536, 1, 65),
        ]
        for (t, m, p, len) in cases {
            XCTAssertThrowsError(try Argon2idParams.checked(iterations: t, memoryKib: m, parallelism: p, length: len),
                                 "t=\(t) m=\(m) p=\(p) len=\(len)")
        }
    }

    func testShortSaltIsRefused() throws {
        let params = try Argon2idParams.checked(iterations: 1, memoryKib: 64, parallelism: 1, length: 32)
        XCTAssertThrowsError(try VaultArgon2id.derive(password: [1], salt: [UInt8](repeating: 0, count: 7), params: params)) {
            XCTAssertEqual($0 as? Argon2idFailure, .invalid("salt must be at least 8 bytes"))
        }
    }

    func testWipeZeroesTheBuffer() {
        var bytes: [UInt8] = [1, 2, 3, 4]
        VaultArgon2id.wipe(&bytes)
        XCTAssertEqual(bytes, [0, 0, 0, 0])
    }
}
