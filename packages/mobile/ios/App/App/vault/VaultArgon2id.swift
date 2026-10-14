// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native Argon2id for the XChainVault `argon2id` method: the same derivation
// the WebView runs in JavaScript, at native speed, with the same parameters.
// The output must equal the JS output byte for byte, because every existing
// wallet was encrypted under it; AppTests holds this file to the golden vectors.

import Argon2
import Darwin
import Foundation
import os

/// Why a derivation was refused. Every case becomes a call.reject, and the JS
/// side answers any rejection by running its own implementation instead.
enum Argon2idFailure: Error, Equatable {
    case invalid(String)
    case outOfMemory
    case failed(String)

    /// The short reject message; never carries the password, salt or key.
    var message: String {
        switch self {
        case .invalid(let reason): return reason
        case .outOfMemory: return "argon2id: not enough memory"
        case .failed(let reason): return "argon2id failed: \(reason)"
        }
    }
}

/// One derivation's cost parameters. Only `checked` builds one, so a value of
/// this type has already passed every bound in the plugin contract.
struct Argon2idParams {
    static let iterationRange = 1...64
    static let parallelismRange = 1...8
    static let maxMemoryKib = 1_048_576
    static let lengthRange = 4...64
    static let minSaltBytes = 8

    let iterations: Int
    let memoryKib: Int
    let parallelism: Int
    let length: Int

    static func checked(iterations: Int, memoryKib: Int, parallelism: Int, length: Int) throws -> Argon2idParams {
        // Iterations stay within 1 to 64 passes over memory.
        guard iterationRange.contains(iterations) else {
            throw Argon2idFailure.invalid("iterations must be 1..64")
        }
        // Parallelism stays within 1 to 8 lanes.
        guard parallelismRange.contains(parallelism) else {
            throw Argon2idFailure.invalid("parallelism must be 1..8")
        }
        // Memory is at least 8 KiB per lane (the Argon2 floor) and at most 1 GiB.
        guard memoryKib >= 8 * parallelism, memoryKib <= maxMemoryKib else {
            throw Argon2idFailure.invalid("memoryKib must be 8*parallelism..1048576")
        }
        // The key is 4 to 64 bytes; the wallet asks for 32.
        guard lengthRange.contains(length) else {
            throw Argon2idFailure.invalid("length must be 4..64")
        }
        return Argon2idParams(iterations: iterations, memoryKib: memoryKib, parallelism: parallelism, length: length)
    }
}

enum VaultArgon2id {

    /// Derives the key with Argon2id v1.3 (0x13), no secret and no associated
    /// data. Blocks for the whole derivation, so callers run it off the main thread.
    /// Headroom kept free beyond the derivation's own block: the WebView and the
    /// rest of the app keep allocating while it runs, so a request that only just
    /// fits could still cross the kill limit instead of rejecting to the JS KDF.
    static let memoryMarginBytes: UInt64 = 64 * 1024 * 1024

    /// Whether `kib` of working memory plus the margin fits in `available`
    /// bytes; 0 is what the OS reports when it cannot say (the simulator), so it passes.
    static func hasMemory(forKib kib: Int, available: Int) -> Bool {
        available == 0 || UInt64(available) >= UInt64(kib) * 1024 + memoryMarginBytes
    }

    /// `availableMemory` is the process's remaining allowance in bytes; tests
    /// pass a figure to drive the refusal, the plugin takes the OS reading.
    static func derive(password: [UInt8], salt: [UInt8], params: Argon2idParams,
                       availableMemory: Int = os_proc_available_memory()) throws -> [UInt8] {
        // The salt is at least 8 bytes, the Argon2 minimum.
        guard salt.count >= Argon2idParams.minSaltBytes else {
            throw Argon2idFailure.invalid("salt must be at least 8 bytes")
        }
        // Refuse up front when the process cannot have the memory, since iOS ends
        // an app that overcommits instead of failing its malloc.
        guard hasMemory(forKib: params.memoryKib, available: availableMemory) else {
            throw Argon2idFailure.outOfMemory
        }

        var key = [UInt8](repeating: 0, count: params.length)
        let rc: Int32 = password.withUnsafeBytes { pwd in
            salt.withUnsafeBytes { saltBytes in
                key.withUnsafeMutableBytes { out in
                    argon2id_hash_raw(
                        UInt32(params.iterations), UInt32(params.memoryKib), UInt32(params.parallelism),
                        pwd.baseAddress, pwd.count,
                        saltBytes.baseAddress, saltBytes.count,
                        out.baseAddress, out.count
                    )
                }
            }
        }
        guard rc == ARGON2_OK.rawValue else {
            wipe(&key)
            if rc == ARGON2_MEMORY_ALLOCATION_ERROR.rawValue { throw Argon2idFailure.outOfMemory }
            throw Argon2idFailure.failed(String(cString: argon2_error_message(rc)))
        }
        return key
    }

    /// Overwrites the bytes with zeros; memset_s is never optimised away.
    static func wipe(_ bytes: inout [UInt8]) {
        bytes.withUnsafeMutableBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            _ = memset_s(base, buffer.count, 0, buffer.count)
        }
    }

    /// Overwrites a Data buffer with zeros in place.
    static func wipe(_ data: inout Data) {
        data.resetBytes(in: 0..<data.count)
    }
}
