// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `XChainVault`, the iOS twin of Android's XChainVaultPlugin.kt (S2).
//
// The contract is not defined here. It is defined once, in the SPA, at
// packages/web/src/storage/nativeVault.js: the plugin name, the methods,
// and the reply shape `{ status, blob | secret, detail }` where status is one
// of OK / ABSENT / LOCKED / CORRUPT. Both native shells implement THAT, which
// is why the mobile package ships no JavaScript of its own. Any change here
// that is not also made in the Kotlin twin is a divergence between two shells
// that are supposed to be one wallet.
//
// SSC-1 applies to this file specifically: it is the whole native surface the
// WebView can reach, so it stays the only registered plugin, and every method
// on it either moves an opaque ciphertext or asks the Secure Enclave a
// question. Nothing here takes a file path, a URL, or a class name from JS.

import Capacitor
import Foundation

@objc(XChainVaultPlugin)
public class XChainVaultPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "XChainVaultPlugin"
    public let jsName = "XChainVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadVault", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveVault", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearVault", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadMeta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveMeta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMeta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadGuards", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveGuards", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearGuards", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricEnroll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricUnlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricClear", returnType: CAPPluginReturnPromise)
    ]

    private var vaultStore: VaultStore?
    private var metaStore: VaultStore?
    private var guardStore: VaultStore?
    private let sidecar = VaultBiometricSidecar()

    /// Store construction can fail (no Application Support directory), and a
    /// plugin that trapped there would take the app down on launch. It fails
    /// per-call instead, as LOCKED, which the JS side surfaces as "the vault
    /// is unavailable" rather than as "there is no wallet".
    private func store(_ which: String, _ call: CAPPluginCall) -> VaultStore? {
        do {
            switch which {
            case "vault":
                if vaultStore == nil { vaultStore = try VaultStore(name: "vault") }
                return vaultStore
            case "guards":
                if guardStore == nil { guardStore = try VaultStore(name: "guards") }
                return guardStore
            default:
                if metaStore == nil { metaStore = try VaultStore(name: "meta") }
                return metaStore
            }
        } catch {
            call.resolve([
                "status": "LOCKED",
                "detail": "vault storage is unavailable: \(error.localizedDescription)"
            ])
            return nil
        }
    }

    // MARK: - Vault blob

    @objc func loadVault(_ call: CAPPluginCall) {
        guard let store = store("vault", call) else { return }
        respondRead(call, store.read())
    }

    @objc func saveVault(_ call: CAPPluginCall) {
        guard let store = store("vault", call) else { return }
        respondWrite(call, store)
    }

    @objc func clearVault(_ call: CAPPluginCall) {
        guard let store = store("vault", call) else { return }
        store.clear()
        // Clearing the vault retires the biometric wrap with it: a wrap that
        // outlived the vault it opened would offer to unlock nothing, and
        // would still be holding the old password.
        sidecar.clear()
        call.resolve(["status": "OK"])
    }

    // MARK: - Meta (kdfParams)

    @objc func loadMeta(_ call: CAPPluginCall) {
        guard let store = store("meta", call) else { return }
        respondRead(call, store.read())
    }

    @objc func saveMeta(_ call: CAPPluginCall) {
        guard let store = store("meta", call) else { return }
        respondWrite(call, store)
    }

    @objc func clearMeta(_ call: CAPPluginCall) {
        guard let store = store("meta", call) else { return }
        store.clear()
        call.resolve(["status": "OK"])
    }

    // MARK: - Guards (SSC-7: lockout ladder, duress hash, panic freeze)

    // Read on the Locked screen, before the vault password exists, so they
    // cannot live in the vault; and not in WebView storage either, because
    // every one of them fails SILENTLY when that store is evicted (
    // §3). Their own slot rather than a corner of the meta record, so a
    // guard write can never corrupt the kdfParams a wallet needs to open.

    @objc func loadGuards(_ call: CAPPluginCall) {
        guard let store = store("guards", call) else { return }
        respondRead(call, store.read())
    }

    @objc func saveGuards(_ call: CAPPluginCall) {
        guard let store = store("guards", call) else { return }
        respondWrite(call, store)
    }

    @objc func clearGuards(_ call: CAPPluginCall) {
        guard let store = store("guards", call) else { return }
        store.clear()
        call.resolve(["status": "OK"])
    }

    // MARK: - Biometric sidecar

    @objc func biometricStatus(_ call: CAPPluginCall) {
        let status = sidecar.status()
        call.resolve([
            "status": "OK",
            "available": status.available,
            "enrolled": status.enrolled,
            "detail": status.detail,
            // The code is what the JS maps to plain language;
            // `detail` stays a developer string and is never shown to a user.
            "reasonCode": status.reasonCode,
            "mechanism": status.mechanism
        ])
    }

    @objc func biometricEnroll(_ call: CAPPluginCall) {
        guard let secret = decodeArg(call, "secret") else { return }
        if let refusal = sidecar.enroll(secret: secret) {
            call.resolve(["status": "LOCKED", "detail": refusal])
        } else {
            call.resolve(["status": "OK"])
        }
    }

    @objc func biometricUnlock(_ call: CAPPluginCall) {
        sidecar.unlock(reason: "Unlock your XChain Wallet") { secret, status, detail in
            var reply: [String: Any] = ["status": status, "detail": detail]
            if let secret = secret {
                reply["secret"] = secret.base64EncodedString()
            }
            call.resolve(reply)
        }
    }

    @objc func biometricClear(_ call: CAPPluginCall) {
        sidecar.clear()
        call.resolve(["status": "OK"])
    }

    // MARK: - Helpers

    private func respondRead(_ call: CAPPluginCall, _ result: VaultReadResult) {
        switch result {
        case .absent:
            call.resolve(["status": "ABSENT"])
        case .ok(let payload):
            call.resolve(["status": "OK", "blob": payload.base64EncodedString()])
        case .locked(let detail):
            call.resolve(["status": "LOCKED", "detail": detail])
        case .corrupt(let detail):
            call.resolve(["status": "CORRUPT", "detail": detail])
        }
    }

    private func respondWrite(_ call: CAPPluginCall, _ store: VaultStore) {
        guard let payload = decodeArg(call, "blob") else { return }
        if let refusal = store.write(payload) {
            // Resolved, not rejected, and the distinction is the point: the JS
            // side has to tell a "would not" from a "crashed", because only
            // the former means the previous vault is still intact on disk.
            call.resolve(["status": "LOCKED", "detail": refusal])
        } else {
            call.resolve(["status": "OK"])
        }
    }

    /// A base64 argument, or a rejected call. Rejected rather than resolved
    /// with a status: a malformed argument is the CALLER being broken, not the
    /// vault being unavailable, and the two must not read the same.
    private func decodeArg(_ call: CAPPluginCall, _ name: String) -> Data? {
        guard let raw = call.getString(name), !raw.isEmpty else {
            call.reject("\(name) is required")
            return nil
        }
        guard let data = Data(base64Encoded: raw) else {
            call.reject("\(name) is not valid base64")
            return nil
        }
        return data
    }
}
