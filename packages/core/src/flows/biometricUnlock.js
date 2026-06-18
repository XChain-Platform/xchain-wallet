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

/**
 * Detect whether the host environment can register a biometric
 * credential. Three preconditions:
 *   1. WebAuthn is exposed (`navigator.credentials.create/get`).
 *   2. The static `PublicKeyCredential` global is defined (so we can
 *      probe platform-authenticator availability).
 *   3. A platform authenticator is present (Touch ID / Windows Hello /
 *      Android biometric).
 *
 * PRF support cannot be probed in advance. It is discovered at
 * registration time when `prf.results.first` is missing.
 *
 * @returns {Promise<boolean>}
 */
export async function isBiometricSupported() {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.credentials || typeof navigator.credentials.create !== 'function') {
        return false;
    }
    if (typeof globalThis.PublicKeyCredential === 'undefined') return false;
    const PKC = globalThis.PublicKeyCredential;
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
        return false;
    }
    try {
        return Boolean(await PKC.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (_err) {
        return false;
    }
}

/** @returns {boolean} */
export function isBiometricRegistered() {
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
export function clearBiometricCredential() {
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
export async function registerBiometricCredential({ password, accountName = 'XChain Wallet' }) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('registerBiometricCredential: password is required');
    }
    if (!(await isBiometricSupported())) {
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
export async function unlockWithBiometric() {
    const record = readRecord();
    if (!record) throw new BiometricNotRegisteredError();
    if (!(await isBiometricSupported())) {
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
