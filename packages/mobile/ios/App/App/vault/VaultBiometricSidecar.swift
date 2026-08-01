// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The iOS half of SSC-3 (biometric wrap lifecycle), twin of Android's
// VaultBiometricSidecar.kt.
//
// WHAT THIS IS NOT. It is not an `LAContext.evaluatePolicy` call whose Bool
// the app checks before unlocking. That pattern is theatre: the secret it
// guards was readable the whole time, so anything that skips the check - a
// patched binary, a jailbroken device, a bug in the calling path - gets the
// wallet. Here the secret is stored in a Keychain item that CANNOT be read
// without a biometric match, so the enforcement is the Secure Enclave's, and
// there is no branch in this file that a caller could fail to take.
//
// WHY `.biometryCurrentSet` AND NOT `.biometryAny`. SSC-3 requires the wrap
// to be destroyed when biometrics are re-enrolled, because a wrap that
// survives a new face or finger being added is a wrap that now opens for
// somebody else. `.biometryCurrentSet` binds the item to the enrolled set as
// it stands: the OS deletes the item when that set changes, so the rule is
// enforced by the platform rather than by app code that has to remember to
// run. The resulting `errSecItemNotFound` is reported as ABSENT, which is
// exactly what the JS provider treats as "wrap is gone, fall back to the
// password" (nativeBiometricProvider.js).
//
// SCOPE: this gates UNLOCK, never a signing approval, and the password stays
// the KDF root. What is stored here is a copy of the password, not the vault
// key: the vault's own key derivation is unchanged, so a wrap that is lost or
// refused costs the user a password entry and nothing more.

import Foundation
import LocalAuthentication
import Security

struct BiometricAvailability {
    let available: Bool
    let enrolled: Bool
    let detail: String
}

final class VaultBiometricSidecar {

    private static let service = "io.xchain.wallet.ios.biometric-wrap"
    private static let account = "vault-password"

    /// Whether the device can do biometrics at all, and whether we hold a wrap.
    ///
    /// `available` deliberately asks LocalAuthentication rather than reading a
    /// stored flag: biometrics can be turned off, locked out after failures,
    /// or absent on the device, and an affordance offered in any of those
    /// states is one that fails in the user's hand.
    func status() -> BiometricAvailability {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics, error: &error
        )
        return BiometricAvailability(
            available: canEvaluate,
            enrolled: wrapExists(),
            detail: canEvaluate
                ? "biometry available"
                : (error?.localizedDescription ?? "biometry unavailable")
        )
    }

    /// Store `secret` behind a fresh biometric match.
    ///
    /// The prompt here is not ceremony: it proves the person enabling the
    /// shortcut is the person whose biometric will later use it, on a device
    /// that may be unlocked and briefly unattended.
    ///
    /// - Returns: nil on success, or the reason it was refused.
    func enroll(secret: Data) -> String? {
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            // Requires a passcode to be set, and dies with it. A wrap that
            // outlived the device passcode would be a secret protected by
            // nothing.
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            nil
        ) else {
            return "this device cannot protect a secret with the current biometric set"
        }

        // Replace rather than add: an existing wrap belongs to an older
        // password or an older enrolment, and keeping it would leave two
        // answers to one question.
        clear()

        let insert: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecAttrAccessControl as String: access,
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: secret
        ]
        let status = SecItemAdd(insert as CFDictionary, nil)
        guard status == errSecSuccess else {
            return "the keychain refused the biometric wrap (OSStatus \(status))"
        }
        return nil
    }

    /// Read the wrapped secret, prompting for biometrics.
    ///
    /// - Returns: `(secret, status, detail)` where status is one of the
    ///   contract's OK / ABSENT / LOCKED strings. ABSENT is load-bearing: it
    ///   is what the OS gives us after a re-enrolment invalidated the item,
    ///   and the JS side reads it as "stop offering this, ask for the
    ///   password" rather than as a failure to show the user.
    func unlock(reason: String, completion: @escaping (Data?, String, String) -> Void) {
        let context = LAContext()
        context.localizedReason = reason
        // No `touchIDAuthenticationAllowableReuseDuration`: SSC-3 forbids a
        // window in which a previous authentication keeps opening the item.

        // The prompt text rides on the LAContext, not on the deprecated
        // kSecUseOperationPrompt: passing both is how you end up with two
        // sources of truth for what the user is being asked to authorise.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context
        ]

        // SecItemCopyMatching blocks while the prompt is up.
        DispatchQueue.global(qos: .userInitiated).async {
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            DispatchQueue.main.async {
                switch status {
                case errSecSuccess:
                    guard let data = item as? Data else {
                        completion(nil, "LOCKED", "the biometric wrap returned no data")
                        return
                    }
                    completion(data, "OK", "unlocked")
                case errSecItemNotFound:
                    completion(nil, "ABSENT", "no biometric wrap is stored, or it was invalidated")
                case errSecUserCanceled:
                    completion(nil, "LOCKED", "the biometric prompt was cancelled")
                case errSecAuthFailed:
                    completion(nil, "LOCKED", "biometric authentication failed")
                default:
                    completion(nil, "LOCKED", "the keychain refused the wrap (OSStatus \(status))")
                }
            }
        }
    }

    /// Destroy the wrap. Called on password change, on biometric disable, and
    /// on explicit opt-out; all three are SSC-3 requirements, and all three
    /// route here rather than each doing their own delete.
    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account
        ]
        SecItemDelete(query as CFDictionary)
    }

    /// Whether a wrap is stored, WITHOUT prompting.
    ///
    /// `interactionNotAllowed` is the whole point: asking "do we have one"
    /// must never put a Face ID sheet in front of someone who merely opened
    /// settings. A stored-but-locked item answers `errSecInteractionNotAllowed`,
    /// which is still a yes.
    private func wrapExists() -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
            kSecUseAuthenticationContext as String: context,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }
}
