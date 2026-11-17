// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Recovery-phrase password reset: the sealed pieces (operator ruling 2026-11-16).
//
// A forgotten password must not cost the wallet. The vault document is sealed
// under a key derived from the password, and so is every wallet record's seed,
// imported private keys and 25th word, each under its OWN derivation (a wallet
// added after onboarding has its own salt). Recovering only the document key
// would open contacts and records but leave every seal shut, so the record
// below carries a key bundle: the document key plus each wallet's seal key.
//
// Three layers, all AES-256-GCM with domain-separating AAD:
//
//   recovery key RK   32 random bytes; never stored in the clear
//   keySeal           RK sealed under the vault document key, so an unlocked
//                     session can update the record without any phrase
//   bundle            the document key and every wallet seal key, sealed
//                     under RK
//   entries[]         RK sealed under a key derived from one seed wallet's
//                     recovery phrase (Argon2id over the normalized words),
//                     one entry per seed wallet, AAD naming its wallet id
//
// Any one entry's phrase opens RK, RK opens the bundle, and the bundle opens
// the vault and every wallet that shares the unlock password. That is the
// point and also the threat: any seed held in the vault resets the password.
//
// The record is plain metadata beside the vault blob (the meta slot), so the
// lock screen can use it before any password is known. Nothing in it opens
// without a phrase or the current vault key.

import { decrypt, encrypt } from './aead.js';
import {
    bytesToBase64,
    base64ToBytes,
    deriveMasterKeyAsync,
    makeFreshKdfParams,
    KDF_KEY_LENGTH,
} from './kdf.js';
import { normalizeRecoveryPhrase } from './recoveryPhrase.js';

export const PHRASE_RECOVERY_VERSION = 1;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Every seal names what it holds, so no blob can be replayed as another.
export const RECOVERY_KEY_SEAL_AAD = ENCODER.encode('xchain-wallet:phrase-recovery:key-seal:v1');
export const RECOVERY_BUNDLE_AAD = ENCODER.encode('xchain-wallet:phrase-recovery:bundle:v1');
const ENTRY_AAD_PREFIX = 'xchain-wallet:phrase-recovery:entry:v1:';
// Prefixed to the words before the KDF so a phrase-derived key can never equal
// a password-derived one, even for a password that happens to be the phrase.
const PHRASE_KDF_DOMAIN = 'xchain-wallet:recovery-phrase:v1\n';

/** @param {string} walletId */
export function recoveryEntryAad(walletId) {
    return ENCODER.encode(`${ENTRY_AAD_PREFIX}${walletId}`);
}

/**
 * Fresh Argon2id params for the phrase KDF: the password floor (64 MiB, t=3,
 * p=1) and a 16-byte salt, never calibrated upward. A BIP39 phrase carries at
 * least 128 bits of entropy, so the KDF is defence in depth, not the barrier;
 * the floor keeps every device able to open what another device wrote.
 */
export function makePhraseKdfParams() {
    return makeFreshKdfParams();
}

/** 32 random bytes; the caller zeroes them. */
export function makeRecoveryKey() {
    const key = new Uint8Array(KDF_KEY_LENGTH);
    crypto.getRandomValues(key);
    return key;
}

/**
 * Derive the key one recovery phrase unwraps its entry with. The phrase is
 * normalized exactly as the import screen normalizes it (case, spacing,
 * display numbering), so the words a user would type to restore are the
 * words that reset.
 *
 * @param {string} phrase
 * @param {import('./kdf.js').KdfParams} params
 * @returns {Promise<Uint8Array>}  caller zeroes
 */
export async function derivePhraseKey(phrase, params) {
    const normalized = normalizeRecoveryPhrase(phrase);
    if (!normalized) throw new TypeError('phraseRecovery: phrase is empty');
    return deriveMasterKeyAsync(`${PHRASE_KDF_DOMAIN}${normalized}`, params);
}

/**
 * @param {Uint8Array} key
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} aad
 * @returns {Promise<string>}
 */
async function seal(key, plaintext, aad) {
    return bytesToBase64(await encrypt(key, plaintext, aad));
}

/**
 * Open a seal, or null when the key or AAD is wrong (a GCM tag mismatch) or
 * the blob is malformed. Any other failure (no WebCrypto) still throws.
 *
 * @param {Uint8Array} key
 * @param {unknown} blob
 * @param {Uint8Array} aad
 * @returns {Promise<Uint8Array | null>}
 */
async function openOrNull(key, blob, aad) {
    if (typeof blob !== 'string' || blob.length === 0) return null;
    let bytes;
    try {
        bytes = base64ToBytes(blob);
    } catch {
        return null;
    }
    // A blob too short to hold an IV and tag is a damaged record, not a key fault.
    if (bytes.length < 28) return null;
    try {
        return await decrypt(key, bytes, aad);
    } catch (err) {
        if (/** @type {any} */ (err)?.name === 'AeadAuthError') return null;
        throw err;
    }
}

/** @param {Uint8Array} vaultKey @param {Uint8Array} recoveryKey */
export function sealRecoveryKey(vaultKey, recoveryKey) {
    return seal(vaultKey, recoveryKey, RECOVERY_KEY_SEAL_AAD);
}

/** @param {Uint8Array} vaultKey @param {unknown} keySeal @returns {Promise<Uint8Array | null>} */
export async function openRecoveryKey(vaultKey, keySeal) {
    const key = await openOrNull(vaultKey, keySeal, RECOVERY_KEY_SEAL_AAD);
    if (key && key.length !== KDF_KEY_LENGTH) {
        key.fill(0);
        return null;
    }
    return key;
}

/** @param {Uint8Array} phraseKey @param {Uint8Array} recoveryKey @param {string} walletId */
export function sealRecoveryEntry(phraseKey, recoveryKey, walletId) {
    return seal(phraseKey, recoveryKey, recoveryEntryAad(walletId));
}

/**
 * @param {Uint8Array} phraseKey
 * @param {{ walletId?: unknown, wrap?: unknown }} entry
 * @returns {Promise<Uint8Array | null>}  the recovery key, or null when this phrase is not that entry's
 */
export async function openRecoveryEntry(phraseKey, entry) {
    if (!entry || typeof entry.walletId !== 'string' || !entry.walletId) return null;
    const key = await openOrNull(phraseKey, entry.wrap, recoveryEntryAad(entry.walletId));
    if (key && key.length !== KDF_KEY_LENGTH) {
        key.fill(0);
        return null;
    }
    return key;
}

/**
 * @typedef {Object} RecoveryBundle
 * @property {Uint8Array} vaultKey
 * @property {Map<string, Uint8Array>} walletKeys   wallet id to that wallet's seal key
 */

/**
 * Seal the key bundle under RK. Binary layout, so every key can be zeroed:
 * [vaultKey 32] [count u16] then per wallet [idLen u16] [id utf8] [key 32].
 *
 * @param {Uint8Array} recoveryKey
 * @param {RecoveryBundle} bundle
 * @returns {Promise<string>}
 */
export async function sealRecoveryBundle(recoveryKey, { vaultKey, walletKeys }) {
    const rows = [...walletKeys.entries()].map(([id, key]) => [ENCODER.encode(id), key]);
    let size = KDF_KEY_LENGTH + 2;
    for (const [id] of rows) size += 2 + id.length + KDF_KEY_LENGTH;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    out.set(vaultKey, 0);
    view.setUint16(KDF_KEY_LENGTH, rows.length);
    let at = KDF_KEY_LENGTH + 2;
    for (const [id, key] of rows) {
        if (!(key instanceof Uint8Array) || key.length !== KDF_KEY_LENGTH) {
            out.fill(0);
            throw new Error('phraseRecovery: a wallet key must be 32 bytes');
        }
        view.setUint16(at, id.length);
        at += 2;
        out.set(id, at);
        at += id.length;
        out.set(key, at);
        at += KDF_KEY_LENGTH;
    }
    try {
        return await seal(recoveryKey, out, RECOVERY_BUNDLE_AAD);
    } finally {
        out.fill(0);
    }
}

/**
 * @param {Uint8Array} recoveryKey
 * @param {unknown} blob
 * @returns {Promise<RecoveryBundle | null>}  every key is the caller's to zero (zeroRecoveryBundle)
 */
export async function openRecoveryBundle(recoveryKey, blob) {
    const plain = await openOrNull(recoveryKey, blob, RECOVERY_BUNDLE_AAD);
    if (!plain) return null;
    /** @type {Uint8Array | null} */
    let vaultKey = null;
    const walletKeys = new Map();
    try {
        if (plain.length < KDF_KEY_LENGTH + 2) return null;
        const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
        vaultKey = plain.slice(0, KDF_KEY_LENGTH);
        const count = view.getUint16(KDF_KEY_LENGTH);
        let at = KDF_KEY_LENGTH + 2;
        for (let i = 0; i < count; i += 1) {
            if (at + 2 > plain.length) throw new RangeError('truncated');
            const idLen = view.getUint16(at);
            at += 2;
            if (at + idLen + KDF_KEY_LENGTH > plain.length) throw new RangeError('truncated');
            const id = DECODER.decode(plain.subarray(at, at + idLen));
            at += idLen;
            walletKeys.set(id, plain.slice(at, at + KDF_KEY_LENGTH));
            at += KDF_KEY_LENGTH;
        }
        return { vaultKey, walletKeys };
    } catch {
        // A malformed bundle: the copies taken before the parse failed hold
        // real keys, and nobody else will ever see them to zero them.
        zeroRecoveryBundle({ vaultKey, walletKeys });
        return null;
    } finally {
        plain.fill(0);
    }
}

/** @param {RecoveryBundle | null | undefined} bundle */
export function zeroRecoveryBundle(bundle) {
    if (!bundle) return;
    bundle.vaultKey?.fill(0);
    for (const key of bundle.walletKeys?.values?.() ?? []) key.fill(0);
}
