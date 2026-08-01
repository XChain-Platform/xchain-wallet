// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The iOS half of SSC-2 (vault blob lifecycle), the twin of Android's
// VaultStore.kt. One opaque ciphertext blob, encrypted under a Keychain-held
// AES-256-GCM key; the plaintext vault document never reaches this layer.
//
// WHY A KEYCHAIN KEY PLUS A FILE, RATHER THAN THE BLOB IN THE KEYCHAIN. The
// Keychain is built for small secrets, and a vault document with many
// addresses is not small. So the file carries the ciphertext and the Keychain
// carries the 32 bytes that open it, which is also what makes the two
// half-states below possible and why each one is resolved explicitly.
//
// THE TWO HALF-STATES, and why neither may be reported as "no wallet here".
// The two stores have different lifetimes on iOS:
//
//   KEY WITHOUT BLOB. Keychain items survive app deletion; the container does
//   not. So a reinstall leaves last install's key with nothing to open. That
//   IS an empty device, so it answers ABSENT - but the orphan key is deleted
//   on the way past, because a new wallet must never be written under a key
//   whose age and provenance nobody can account for.
//
//   BLOB WITHOUT KEY. The backup exclusion (§4) can restore a container while
//   the key, being `ThisDeviceOnly` and non-synchronizable, does not come
//   with it. The ciphertext is then unopenable by anyone forever. That is
//   CORRUPT, not ABSENT: the user's recovery path is the seed phrase, and the
//   screen that says so is the one CORRUPT produces. ABSENT would offer to
//   create a new wallet on top of it.
//
// A LOCKED DEVICE IS NOT AN EMPTY ONE. `WhenUnlockedThisDeviceOnly` means a
// read attempted while the device is locked returns errSecInteractionNotAllowed,
// which is reported as LOCKED. core's StorageBackend contract exists for
// exactly this: null means ABSENT and nothing else.

import CryptoKit
import Foundation
import Security

/// The four answers a read can give. Mirrors VaultReadResult.java and the
/// `status` values `nativeVault.js` decodes; the JS side turns anything it
/// does not recognise into an error rather than into absence, so these names
/// are a wire contract, not an internal enum.
enum VaultReadResult {
    case absent
    case ok(Data)
    case locked(String)
    case corrupt(String)
}

/// A Keychain refusal, carrying the OSStatus that caused it.
///
/// Exists because `Result` needs an `Error`, and OSStatus is an Int32. The
/// status is kept rather than flattened to a Bool: the difference between
/// "device locked", "no such item" and everything else is exactly what decides
/// LOCKED vs ABSENT vs CORRUPT, and that decision must not be made here.
struct KeychainFailure: Error {
    let status: OSStatus
}

/// One encrypted store. The app runs two: the vault blob and the kdfParams
/// meta record, each with its own file and its own Keychain key, so that
/// losing or invalidating one cannot silently take the other with it.
final class VaultStore {

    /// Keychain service; the account distinguishes vault from meta.
    private static let service = "io.xchain.wallet.ios.vault"

    private let account: String
    private let fileURL: URL
    private let previousURL: URL
    private let fileManager = FileManager.default

    /// - Parameter name: `vault` or `meta`; names both the Keychain account
    ///   and the file, so the pairing is visible in both stores.
    init(name: String) throws {
        self.account = name
        let support = try fileManager.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        // Application Support, not Documents: Documents is exposed to the
        // Files app the moment anyone sets UIFileSharingEnabled, and a vault
        // that a file browser can see is a vault that can be deleted by hand.
        var dir = support.appendingPathComponent("XChainVault", isDirectory: true)
        if !fileManager.fileExists(atPath: dir.path) {
            try fileManager.createDirectory(
                at: dir,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUnlessOpen]
            )
        }

        // Keep the vault out of iCloud and Finder backups ( §4; the
        // Android twin is allowBackup="false"). Not a belt-and-braces nicety:
        // the key that opens these files is `ThisDeviceOnly`, so a backup could
        // only ever restore ciphertext onto a device with no way to read it -
        // the BLOB WITHOUT KEY half-state above. Excluding the directory means
        // a restored device says "no wallet" and asks for the seed phrase,
        // instead of carrying a vault it can never open. Applied on every
        // launch rather than only at creation, because a directory that
        // predates this rule would otherwise keep the old flag forever.
        var backupPosture = URLResourceValues()
        backupPosture.isExcludedFromBackup = true
        try? dir.setResourceValues(backupPosture)
        self.fileURL = dir.appendingPathComponent("\(name).blob")
        self.previousURL = dir.appendingPathComponent("\(name).blob.prev")
    }

    // MARK: - Read

    func read() -> VaultReadResult {
        let blobExists = fileManager.fileExists(atPath: fileURL.path)

        let keyLookup = loadKey()
        switch keyLookup {
        case .failure(let failure) where failure.status == errSecInteractionNotAllowed:
            // Device locked. Says nothing about whether a vault exists, so it
            // must not be allowed to imply one way or the other.
            return .locked("the device is locked, so the vault key is unreadable")
        case .failure(let failure) where failure.status == errSecItemNotFound:
            if !blobExists { return .absent }
            return .corrupt(
                "the vault key is gone but its ciphertext remains: this container was restored "
                + "onto a device that cannot hold its key. Recover from the seed phrase."
            )
        case .failure(let failure):
            return .locked("the keychain refused the vault key (OSStatus \(failure.status))")
        case .success(let key):
            guard blobExists else {
                // Key without blob: a reinstall. Retire the orphan rather than
                // encrypt a new wallet under it.
                deleteKey()
                return .absent
            }
            do {
                let ciphertext = try Data(contentsOf: fileURL)
                let box = try AES.GCM.SealedBox(combined: ciphertext)
                return .ok(try AES.GCM.open(box, using: key))
            } catch is CryptoKitError {
                return .corrupt("the stored vault failed its authentication tag")
            } catch {
                return .corrupt("the stored vault could not be read: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Write

    /// Persist `payload`, or return the reason it was refused.
    ///
    /// A refusal is a returned string, never a thrown error: the JS side has
    /// to be able to tell "would not" from "crashed", because only the former
    /// guarantees the previous vault is still the one on disk (the same
    /// distinction respondWrite makes on Android).
    func write(_ payload: Data) -> String? {
        let key: SymmetricKey
        switch loadKey() {
        case .success(let existing):
            key = existing
        case .failure(let failure) where failure.status == errSecItemNotFound:
            guard let created = createKey() else {
                return "could not create a vault key in the keychain"
            }
            key = created
        case .failure(let failure) where failure.status == errSecInteractionNotAllowed:
            return "the device is locked, so the vault key is unreadable"
        case .failure(let failure):
            return "the keychain refused the vault key (OSStatus \(failure.status))"
        }

        do {
            let sealed = try AES.GCM.seal(payload, using: key)
            guard let combined = sealed.combined else { return "sealing produced no ciphertext" }

            // Write to a temporary file first, then READ IT BACK AND DECRYPT
            // IT before it is allowed to replace anything. A write that
            // reports success and produced an unopenable file is the failure
            // this ordering exists to make impossible: until the new
            // generation has proven it opens, the old one is still the vault.
            let tmpURL = fileURL.appendingPathExtension("tmp")
            try combined.write(to: tmpURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            let verify = try Data(contentsOf: tmpURL)
            _ = try AES.GCM.open(try AES.GCM.SealedBox(combined: verify), using: key)

            if fileManager.fileExists(atPath: fileURL.path) {
                _ = try? fileManager.removeItem(at: previousURL)
                try fileManager.moveItem(at: fileURL, to: previousURL)
            }
            try fileManager.moveItem(at: tmpURL, to: fileURL)
            _ = try? fileManager.removeItem(at: previousURL)
            return nil
        } catch {
            return "the vault could not be written: \(error.localizedDescription)"
        }
    }

    func clear() {
        _ = try? fileManager.removeItem(at: fileURL)
        _ = try? fileManager.removeItem(at: previousURL)
        _ = try? fileManager.removeItem(at: fileURL.appendingPathExtension("tmp"))
        deleteKey()
    }

    // MARK: - Keychain

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
            // Pinned by  §4 and not an implementation choice: the
            // wallet is foreground-only, so no weaker accessibility class is
            // authorised, and `ThisDeviceOnly` is what keeps vault key
            // material out of iCloud Keychain. `kSecAttrSynchronizable` is
            // false for the same reason, stated rather than defaulted.
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAttrSynchronizable as String: false
        ]
    }

    private func loadKey() -> Result<SymmetricKey, KeychainFailure> {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data, data.count == 32 else {
            // A successful lookup that produced the wrong number of bytes is
            // not a lookup failure; it is a key that cannot be what it claims.
            return .failure(KeychainFailure(status: status == errSecSuccess ? errSecDecode : status))
        }
        return .success(SymmetricKey(data: data))
    }

    private func createKey() -> SymmetricKey? {
        var bytes = Data(count: 32)
        let generated = bytes.withUnsafeMutableBytes { buffer -> Int32 in
            guard let base = buffer.baseAddress else { return errSecAllocate }
            return SecRandomCopyBytes(kSecRandomDefault, 32, base)
        }
        guard generated == errSecSuccess else { return nil }

        var insert = baseQuery()
        insert[kSecValueData as String] = bytes
        SecItemDelete(insert as CFDictionary)
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { return nil }
        return SymmetricKey(data: bytes)
    }

    private func deleteKey() {
        SecItemDelete(baseQuery() as CFDictionary)
    }
}
