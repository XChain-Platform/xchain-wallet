// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Biometric-unlock provider for the native shells ( §1, stage S2).
//
// Core's default provider is WebAuthn + PRF. Inside an Android WebView there
// is no platform authenticator to call, so that provider correctly reports
// "unsupported" and the affordance disappears - on the one platform where a
// user is most likely to expect a fingerprint to unlock their wallet. This
// provider fills that gap by delegating to native BiometricPrompt (Class 3)
// over a Keystore key that requires authentication for every single use.
//
// WHAT IS WRAPPED: the wallet PASSWORD, and this is a deliberate correction
// to the spec's §1 wording ("a cached copy of the vault master key"). In this
// codebase each wallet record's seed is encrypted under the password, not
// under the vault master key - `SignerPool.populate` re-derives every signer
// from it at unlock. A sidecar holding only the master key would open the
// vault document and show balances, then hit a password prompt at the first
// signature: a biometric unlock that does not unlock. The password stays the
// KDF root either way; what biometrics change is only how the user re-supplies
// it, never how it is stretched.
//
// The sidecar's LIFECYCLE is the security-critical part, and it is enforced
// natively (see VaultBiometricSidecar.kt):
//   - auth-per-use with CryptoObject binding, so there is no window during
//     which any code path could use the key without a fresh prompt;
//   - `setInvalidatedByBiometricEnrollment(true)`, so enrolling a new
//     fingerprint destroys the wrap rather than granting the new finger
//     access to the old wallet;
//   - destroyed on disable and on password change (`clear()` below is called
//     from both paths), so a stale wrap can never resurrect an old password.

// Deep import, not the `flows` namespace: hostBridge deliberately lazy-loads
// that index so a page that never onboards doesn't pay for the BIP39
// wordlists behind it, and this module is on the boot path.
import {
    setBiometricProvider,
    BiometricUnsupportedError,
    BiometricNotRegisteredError,
} from '@xchain-wallet/core/flows/biometricUnlock.js';
import { crypto as coreCrypto } from '@xchain-wallet/core';
import { callNativeVault, hasNativeVault, VaultStatus } from './nativeVault.js';

const { bytesToBase64, base64ToBytes } = coreCrypto;

/** Cached enrollment flag: `isRegistered()` is synchronous by contract. */
let enrolledCache = false;

/**
 * Plain-language reasons, keyed on the stable `reasonCode` the native halves
 * emit . The native `detail` beside it is a developer string
 * ("no biometric enrolled", an `NSError` localizedDescription) and is NEVER
 * shown: it is for logs. What the user reads is composed here, in the one
 * place both native shells share, so Android and iOS cannot drift into
 * describing the same condition differently.
 *
 * An unknown code falls through to the generic sentence rather than leaking
 * the raw detail, which is the failure this item is about.
 */
const REASONS = Object.freeze({
    no_hardware: 'This device has no fingerprint or face sensor.',
    hw_unavailable: 'The biometric sensor is not available right now. Try again in a moment.',
    none_enrolled: 'No fingerprint or face is set up on this device yet.'
        + ' Add one in your device security settings, then come back.',
    lockout: 'Too many failed attempts. Unlock this device with its PIN or passcode,'
        + ' then try again.',
    security_update_required: 'This device needs a system security update before biometric'
        + ' unlock can be used.',
    passcode_not_set: 'This device has no screen lock. Set a PIN, pattern, or passcode first,'
        + ' then add a fingerprint or face.',
    unsupported: 'This device cannot use biometric unlock.',
});

/**
 * Ask the native side whether a wrap exists and refresh the cache. Called at
 * boot (see installNativeBiometricProvider) and after every mutation, because
 * the shared UI's `isBiometricRegistered()` cannot await.
 *
 * @returns {Promise<boolean>}
 */
export async function refreshBiometricEnrollment() {
    if (!hasNativeVault()) {
        enrolledCache = false;
        return false;
    }
    try {
        const reply = await callNativeVault('biometricStatus');
        enrolledCache = Boolean(reply?.enrolled);
    } catch (_err) {
        // A status probe that fails means we cannot promise the affordance
        // will work, and a biometric button that errors on tap is worse than
        // no button: the password form below it works either way.
        enrolledCache = false;
    }
    return enrolledCache;
}

export const nativeBiometricProvider = {
    name: 'native-biometric-prompt',

    /**
     * Generic only as a floor: the real wording comes from `describe()` below,
     * which asks the device what it actually has. Android answers with what
     * its sensors report, iOS with Face ID or Touch ID by name. This constant
     * is what the UI falls back to when the probe itself failed.
     */
    mechanism: 'your device biometric',

    wrapNote: 'Your password is encrypted with a key held in this device secure'
        + ' hardware, released only by your biometric, and is never stored in plain text.',

    /**
     * Supported, and in the user's own terms when not.
     *
     * `available` is the native side's judgement (Android maps
     * `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)`, iOS asks
     * LocalAuthentication), and the `reasonCode` beside it is what turns
     * "unavailable" into something the user can act on.
     *
     * @returns {Promise<{ supported: boolean, reason?: string, mechanism?: string }>}
     */
    async describe() {
        if (!hasNativeVault()) return { supported: false };
        let reply;
        try {
            reply = await callNativeVault('biometricStatus');
        } catch (_err) {
            // The probe itself failed, so we know nothing about the device and
            // must not invent a reason for it. Core supplies the generic one.
            return { supported: false };
        }
        const mechanism = typeof reply?.mechanism === 'string' && reply.mechanism
            ? reply.mechanism
            : undefined;
        if (reply?.available) return { supported: true, mechanism };
        return {
            supported: false,
            reason: REASONS[reply?.reasonCode] || undefined,
            mechanism,
        };
    },

    /**
     * Hardware present AND a Class-3 biometric actually enrolled on the
     * device. Kept because the provider contract requires it; `describe()` is
     * what the UI asks, and both read the same native answer.
     */
    async isSupported() {
        if (!hasNativeVault()) return false;
        try {
            const reply = await callNativeVault('biometricStatus');
            return Boolean(reply?.available);
        } catch (_err) {
            return false;
        }
    },

    isRegistered() {
        return enrolledCache;
    },

    /**
     * Wrap the password behind a fresh biometric authentication.
     *
     * The prompt at enrollment time is not ceremony: it proves the person
     * enabling the shortcut is the person whose finger will later use it,
     * on a device that may be unlocked and briefly unattended.
     *
     * @param {{ password: string }} opts
     */
    async register({ password }) {
        if (typeof password !== 'string' || password.length === 0) {
            throw new Error('registerBiometricCredential: password is required');
        }
        const described = await nativeBiometricProvider.describe();
        if (!described.supported) {
            throw new BiometricUnsupportedError(described.reason || REASONS.unsupported);
        }
        const secret = bytesToBase64(new TextEncoder().encode(password));
        const reply = await callNativeVault('biometricEnroll', { secret });
        if (reply?.status !== VaultStatus.OK) {
            throw new BiometricUnsupportedError(
                reply?.detail || `native enrollment refused (${reply?.status})`,
            );
        }
        enrolledCache = true;
    },

    /** @returns {Promise<string>} the wallet password */
    async unlock() {
        if (!enrolledCache && !(await refreshBiometricEnrollment())) {
            throw new BiometricNotRegisteredError();
        }
        const reply = await callNativeVault('biometricUnlock');
        switch (reply?.status) {
            case VaultStatus.OK: {
                if (typeof reply.secret !== 'string') {
                    throw new BiometricUnsupportedError('native unlock returned no secret');
                }
                return new TextDecoder().decode(base64ToBytes(reply.secret));
            }
            case VaultStatus.ABSENT:
                // The wrap is gone: enrollment changed, or the key was
                // invalidated. Drop the cached flag so the affordance stops
                // being offered, and let the user fall back to the password.
                enrolledCache = false;
                throw new BiometricNotRegisteredError();
            default:
                throw new BiometricUnsupportedError(
                    reply?.detail || `biometric unlock failed (${reply?.status})`,
                );
        }
    },

    /**
     * Destroy the wrap. Synchronous by contract (the shared UI calls it
     * without awaiting), so the native delete is fired and the local flag
     * cleared immediately: the affordance must disappear now, not after a
     * round trip.
     */
    clear() {
        enrolledCache = false;
        if (!hasNativeVault()) return;
        Promise.resolve(callNativeVault('biometricClear')).catch(() => {
            // Best-effort by necessity, and safe: the Keystore key is what
            // guards the wrap, and the paths that call clear() (disable,
            // password change) either rotate the password the wrap holds or
            // are followed by a wipe.
        });
    },
};

/**
 * Install the provider when running natively. No-op in a browser, so the web
 * shell keeps WebAuthn.
 *
 * @returns {Promise<boolean>} whether the native provider took over
 */
export async function installNativeBiometricProvider() {
    if (!hasNativeVault()) return false;
    setBiometricProvider(nativeBiometricProvider);
    await refreshBiometricEnrollment();
    return true;
}
