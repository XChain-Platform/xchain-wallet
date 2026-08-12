// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Biometric unlock (§26 / G063). Uses WebAuthn with the PRF
// (Pseudo-Random Function) extension to derive a 32-byte AES-GCM key
// without persisting the password. The wallet password is encrypted at
// registration time under that key and stored in localStorage; at
// unlock the user authenticates with the platform authenticator
// (Touch ID, Windows Hello, Android biometric, …), the browser
// re-derives the same PRF output, and the password is unwrapped.
//
// Threat model:
//   - The encrypted password sits next to the credential ID in
//     localStorage. Without the platform authenticator + user
//     verification (face / fingerprint / device PIN) it cannot be
//     decrypted. The PRF output is not derivable from anything in
//     localStorage alone.
//   - PRF salt is randomized per registration and stored alongside the
//     credential, so swapping credentials between vaults can't reuse
//     the same wrap key.
//   - The flow refuses to register without `userVerification: 'required'`,
//     so a credential without biometric / PIN gating can't slip in.
//   - Disabling biometric unlock wipes the credential reference and
//     ciphertext from localStorage. The platform authenticator's
//     credential itself can only be cleared via OS settings (this is
//     by design. We don't want a malicious page to delete a user's
//     authenticators).
//
// Scope:
//   - PRF support is required. When unavailable (Firefox today, older
//     browsers, no platform authenticator) `isBiometricSupported` returns
//     false and the UI hides the affordance.
//   - One credential per vault profile. Re-registering replaces the
//     stored credential ID + ciphertext.

import { encrypt as aeadEncrypt, decrypt as aeadDecrypt } from '../crypto/aead.js';

const STORAGE_KEY = 'xchain-wallet:biometric';
const RP_NAME = 'XChain Wallet';
const RP_ID_FALLBACK = 'localhost';

export class BiometricUnsupportedError extends Error {
    constructor(reason) {
        super(`biometricUnlock: not supported (${reason})`);
        this.name = 'BiometricUnsupportedError';
    }
}

export class BiometricNotRegisteredError extends Error {
    constructor() {
        super('biometricUnlock: no credential registered');
        this.name = 'BiometricNotRegisteredError';
    }
}

export class BiometricPrfUnavailableError extends Error {
    constructor() {
        super('biometricUnlock: PRF extension did not return a result; the authenticator does not support PRF');
        this.name = 'BiometricPrfUnavailableError';
    }
}

// ---------------------------------------------------------------------
// Provider seam (S2)
// ---------------------------------------------------------------------
//
// WebAuthn+PRF is the implementation for browsers, and it is the default.
// It is not the only one possible: inside an Android WebView there is no
// platform authenticator to call, so `isBiometricSupported()` answers false
// and the affordance disappears on the one platform whose users most expect
// it. The mobile shell therefore installs a provider backed by native
// BiometricPrompt + a hardware Keystore key.
//
// The seam is here, in core, rather than each shell branching at the call
// site: `Locked.jsx` and `BiometricRow.jsx` are shared UI and must keep
// working verbatim on every shell. Core still imports nothing from a shell -
// the shell hands its provider in at boot.
//
// WHAT A PROVIDER WRAPS, and why it is the password and not the master key:
// each wallet record's seed is encrypted under the PASSWORD (see
// SignerPool.populate → unlockWalletRecord), not under the vault master key.
// A provider that cached only the master key could open the vault document
// and show balances, then fail at the first signature and fall back to a
// password prompt - a biometric unlock that does not actually unlock. So a
// provider releases the password, and the password remains the KDF root:
// biometrics shorten the path to it, they never replace the derivation.
//
// HOW A PROVIDER DESCRIBES ITSELF. The shared UI used to hardcode
// "Touch ID / Windows Hello / device biometric" and explain unavailability in
// terms of WebAuthn and PRF. On a phone that is wrong twice over: it names an
// Apple brand and a Microsoft one on Android, and it explains a browser API to
// someone whose actual problem is that no fingerprint is enrolled - a reason
// the native provider already had and threw away. So the vocabulary belongs to
// the provider, not to the component: each one names its own mechanism and
// gives its own plain-language reason, and `describeBiometric()` below is the
// single thing the UI asks. `mechanism`, `wrapNote` and `describe` are all
// OPTIONAL, so a provider that supplies none still renders correct generic
// copy rather than nothing.
//
// @typedef {Object} BiometricProvider
// @property {() => Promise<boolean>} isSupported
// @property {() => boolean} isRegistered
// @property {(opts: { password: string, accountName?: string }) => Promise<void>} register
// @property {() => Promise<string>} unlock      resolves to the wallet password
// @property {() => void} clear
// @property {string} name
// @property {string} [mechanism]   what the USER uses, in their words
// @property {string} [wrapNote]    how the password is protected, in their words
// @property {() => Promise<{ supported: boolean, reason?: string, mechanism?: string }>} [describe]

/** @type {BiometricProvider | null} */
let installedProvider = null;

/**
 * Install a shell-supplied provider. Call at shell boot, before any UI
 * mounts. Passing null restores the WebAuthn default (used by tests).
 *
 * @param {BiometricProvider | null} provider
 */
export function setBiometricProvider(provider) {
    if (provider === null) {
        installedProvider = null;
        return;
    }
    for (const method of ['isSupported', 'isRegistered', 'register', 'unlock', 'clear']) {
        if (typeof provider?.[method] !== 'function') {
            throw new Error(`setBiometricProvider: provider is missing ${method}()`);
        }
    }
    installedProvider = provider;
}

/** @returns {BiometricProvider} */
function activeProvider() {
    return installedProvider ?? webAuthnProvider;
}

/** Which provider is answering. Diagnostics and tests; not a UI signal. */
export function biometricProviderName() {
    return activeProvider().name;
}

/**
 * Detect whether the host environment can register a biometric
 * credential, AND say why not when it cannot. Three preconditions:
 *   1. WebAuthn is exposed (`navigator.credentials.create/get`).
 *   2. The static `PublicKeyCredential` global is defined (so we can
 *      probe platform-authenticator availability).
 *   3. A platform authenticator is present (Touch ID / Windows Hello /
 *      Android biometric).
 *
 * The reasons are separated because they ask different things of the user:
 * an absent API means "this browser cannot", an absent authenticator means
 * "set one up and come back". Collapsing both into one sentence is what
 * was filed about.
 *
 * PRF support cannot be probed in advance. It is discovered at
 * registration time when `prf.results.first` is missing.
 *
 * @returns {Promise<{ supported: boolean, reason?: string }>}
 */
async function webauthnDescribe() {
    if (typeof navigator === 'undefined'
        || !navigator.credentials
        || typeof navigator.credentials.create !== 'function'
        || typeof globalThis.PublicKeyCredential === 'undefined'
        || typeof globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
        return {
            supported: false,
            reason: 'This browser does not support the sign-in technology biometric unlock needs.',
        };
    }
    try {
        const present = await globalThis.PublicKeyCredential
            .isUserVerifyingPlatformAuthenticatorAvailable();
        if (present) return { supported: true };
        return {
            supported: false,
            reason: 'This device has no built-in fingerprint, face, or PIN unlock that this'
                + ' browser can use. Set one up in your system settings, then come back.',
        };
    } catch (_err) {
        return {
            supported: false,
            reason: 'This browser could not check whether a built-in unlock method is available.',
        };
    }
}

/** @returns {Promise<boolean>} */
async function webauthnIsSupported() {
    return (await webauthnDescribe()).supported;
}

/** @returns {boolean} */
function webauthnIsRegistered() {
    const store = getStorage();
    if (!store) return false;
    try {
        const raw = store.getItem(STORAGE_KEY);
        return Boolean(raw);
    } catch (_err) {
        return false;
    }
}

/** Discard the stored credential reference + ciphertext. */
function webauthnClear() {
    const store = getStorage();
    if (!store) return;
    try { store.removeItem(STORAGE_KEY); } catch (_err) { /* ignore */ }
}

/**
 * Register a biometric credential and encrypt the wallet password under
 * the PRF-derived key.
 *
 * @param {object} opts
 * @param {string} opts.password         the wallet password to wrap
 * @param {string} [opts.accountName]    user-facing label shown by the OS
 * @returns {Promise<void>}
 */
async function webauthnRegister({ password, accountName = 'XChain Wallet' }) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('registerBiometricCredential: password is required');
    }
    if (!(await webauthnIsSupported())) {
        throw new BiometricUnsupportedError('webauthn or platform authenticator missing');
    }

    const prfSalt = randomBytes(32);
    const userIdBytes = randomBytes(32);
    const challengeBytes = randomBytes(32);
    const rpId = inferRpId();

    const cred = await navigator.credentials.create({
        publicKey: {
            challenge: challengeBytes,
            rp: { id: rpId, name: RP_NAME },
            user: {
                id: userIdBytes,
                name: accountName,
                displayName: accountName,
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },    // ES256
                { type: 'public-key', alg: -257 },  // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
                residentKey: 'required',
            },
            timeout: 60_000,
            attestation: 'none',
            extensions: {
                prf: { eval: { first: prfSalt } },
            },
        },
    });

    if (!cred) throw new BiometricUnsupportedError('credential creation returned null');
    const credentialId = new Uint8Array(cred.rawId);

    const extResults = typeof cred.getClientExtensionResults === 'function'
        ? cred.getClientExtensionResults()
        : null;
    let prfOutput = extractPrfOutput(extResults);

    if (!prfOutput) {
        // Some browsers (notably current Chrome) don't return PRF in the
        // create() response. Run an immediate get() with the same salt
        // to obtain the PRF output.
        prfOutput = await derivePrfViaAssertion({
            credentialId,
            prfSalt,
            rpId,
        });
    }
    if (!prfOutput || prfOutput.length < 32) {
        throw new BiometricPrfUnavailableError();
    }

    const key = prfOutput.slice(0, 32);
    const passwordBytes = new TextEncoder().encode(password);
    const ciphertext = await aeadEncrypt(key, passwordBytes);
    key.fill(0);

    persistRecord({
        credentialId: bytesToBase64(credentialId),
        prfSalt: bytesToBase64(prfSalt),
        ciphertext: bytesToBase64(ciphertext),
        createdAt: Date.now(),
    });
}

/**
 * Unwrap and return the wallet password using the registered biometric
 * credential. Caller passes the result to `messaging.unlockWallet`.
 *
 * @returns {Promise<string>}
 */
async function webauthnUnlock() {
    const record = readRecord();
    if (!record) throw new BiometricNotRegisteredError();
    if (!(await webauthnIsSupported())) {
        throw new BiometricUnsupportedError('webauthn or platform authenticator missing');
    }

    const credentialId = base64ToBytes(record.credentialId);
    const prfSalt = base64ToBytes(record.prfSalt);
    const ciphertext = base64ToBytes(record.ciphertext);
    const rpId = inferRpId();

    const prfOutput = await derivePrfViaAssertion({ credentialId, prfSalt, rpId });
    if (!prfOutput || prfOutput.length < 32) {
        throw new BiometricPrfUnavailableError();
    }

    const key = prfOutput.slice(0, 32);
    const plaintext = await aeadDecrypt(key, ciphertext);
    key.fill(0);
    return new TextDecoder().decode(plaintext);
}

/** @type {BiometricProvider} */
const webAuthnProvider = {
    name: 'webauthn-prf',
    // Three vendor names on purpose HERE and nowhere else: in a browser we
    // genuinely cannot tell which of them the user will be shown, and this is
    // the provider that owns that uncertainty. The native providers know
    // exactly, and say so.
    mechanism: 'Touch ID, Windows Hello, or your device unlock',
    wrapNote: 'Your password is encrypted with a key only your device unlock can'
        + ' release, and is never stored in plain text.',
    describe: webauthnDescribe,
    isSupported: webauthnIsSupported,
    isRegistered: webauthnIsRegistered,
    register: webauthnRegister,
    unlock: webauthnUnlock,
    clear: webauthnClear,
};

// ---------------------------------------------------------------------
// Public API: delegates to whichever provider this shell installed
// ---------------------------------------------------------------------

/**
 * Generic copy, used when a provider does not supply its own. Every string a
 * user reads about biometric unlock is either one of these or a provider's,
 * and none of them names a vendor: a component that guesses the mechanism is
 * the defect records.
 */
export const BIOMETRIC_GENERIC_MECHANISM = 'your device biometric';
export const BIOMETRIC_GENERIC_UNAVAILABLE = 'Biometric unlock is not available on this device.';
export const BIOMETRIC_GENERIC_WRAP_NOTE = 'Your password is encrypted and is never stored in plain text.';

/**
 * Everything the UI needs to talk about biometric unlock on THIS device, in
 * the words of whichever provider is answering.
 *
 * Never rejects and never returns a partial object: an unavailable or faulty
 * provider is a state the password form already handles, and a settings row
 * that throws would take the whole panel with it.
 *
 * @returns {Promise<{
 *   provider: string,
 *   supported: boolean,
 *   reason: string | null,
 *   mechanism: string,
 *   wrapNote: string,
 * }>}
 */
export async function describeBiometric() {
    const provider = activeProvider();
    let supported = false;
    let reason = null;
    let mechanism = typeof provider.mechanism === 'string' && provider.mechanism
        ? provider.mechanism
        : BIOMETRIC_GENERIC_MECHANISM;

    try {
        if (typeof provider.describe === 'function') {
            const described = await provider.describe();
            supported = Boolean(described?.supported);
            if (typeof described?.reason === 'string' && described.reason) {
                reason = described.reason;
            }
            // A provider may only learn the mechanism from the same probe
            // (iOS cannot say Face ID vs Touch ID without asking).
            if (typeof described?.mechanism === 'string' && described.mechanism) {
                mechanism = described.mechanism;
            }
        } else {
            supported = Boolean(await provider.isSupported());
        }
    } catch (_err) {
        supported = false;
        reason = null;
    }

    return {
        provider: provider.name,
        supported,
        // Supported means there is nothing to explain; unsupported always
        // explains something, even when the provider declined to.
        reason: supported ? null : (reason || BIOMETRIC_GENERIC_UNAVAILABLE),
        mechanism,
        wrapNote: typeof provider.wrapNote === 'string' && provider.wrapNote
            ? provider.wrapNote
            : BIOMETRIC_GENERIC_WRAP_NOTE,
    };
}

/** @returns {Promise<boolean>} */
export function isBiometricSupported() {
    // Never lets a provider fault reach the UI: an exception here would
    // propagate out of the availability probe in Locked.jsx's effect and
    // take the unlock screen down with it. An unavailable provider means
    // "no biometrics", which is a state the password form already handles.
    try {
        return Promise.resolve(activeProvider().isSupported()).catch(() => false);
    } catch (_err) {
        return Promise.resolve(false);
    }
}

/** @returns {boolean} */
export function isBiometricRegistered() {
    try {
        return Boolean(activeProvider().isRegistered());
    } catch (_err) {
        return false;
    }
}

/**
 * Enroll: wrap the wallet password so the user's biometric can release it.
 *
 * @param {{ password: string, accountName?: string }} opts
 * @returns {Promise<void>}
 */
export function registerBiometricCredential(opts) {
    return activeProvider().register(opts);
}

/**
 * Unwrap and return the wallet password. Caller passes the result to
 * `messaging.unlockWallet`. Errors propagate: unlike the probes above, a
 * failure here is the user's explicit action failing and must be shown.
 *
 * @returns {Promise<string>}
 */
export function unlockWithBiometric() {
    return activeProvider().unlock();
}

/** Discard the enrollment. Called on disable AND on password change. */
export function clearBiometricCredential() {
    activeProvider().clear();
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function getStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch (_err) { /* ignore */ }
    return null;
}

/** @returns {{ credentialId: string, prfSalt: string, ciphertext: string, createdAt: number } | null} */
function readRecord() {
    const store = getStorage();
    if (!store) return null;
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            !parsed
            || typeof parsed.credentialId !== 'string'
            || typeof parsed.prfSalt !== 'string'
            || typeof parsed.ciphertext !== 'string'
        ) {
            return null;
        }
        return parsed;
    } catch (_err) {
        return null;
    }
}

function persistRecord(record) {
    const store = getStorage();
    if (!store) throw new Error('biometricUnlock: localStorage unavailable; cannot persist credential');
    store.setItem(STORAGE_KEY, JSON.stringify(record));
}

function inferRpId() {
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
        return window.location.hostname;
    }
    return RP_ID_FALLBACK;
}

function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
}

function extractPrfOutput(extResults) {
    if (!extResults || typeof extResults !== 'object') return null;
    const prf = extResults.prf;
    if (!prf || !prf.results) return null;
    const first = prf.results.first;
    if (!first) return null;
    return new Uint8Array(first);
}

async function derivePrfViaAssertion({ credentialId, prfSalt, rpId }) {
    const challengeBytes = randomBytes(32);
    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: challengeBytes,
            rpId,
            allowCredentials: [{
                type: 'public-key',
                id: credentialId,
                transports: ['internal'],
            }],
            userVerification: 'required',
            timeout: 60_000,
            extensions: {
                prf: { eval: { first: prfSalt } },
            },
        },
    });
    if (!assertion) return null;
    const ext = typeof assertion.getClientExtensionResults === 'function'
        ? assertion.getClientExtensionResults()
        : null;
    return extractPrfOutput(ext);
}

function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') return btoa(bin);
    // Node fallback.
    return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64) {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
}
