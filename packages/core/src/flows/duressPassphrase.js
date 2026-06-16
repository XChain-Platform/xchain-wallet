// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Duress passphrase — §26.5 / G068 part 2.
//
// A second password the user can configure for emergencies. Entering
// it on the Locked screen silently arms panic mode (24-hour signing
// freeze) and shows the same "Incorrect password" UX a normal wrong
// guess produces — so an observer (someone forcing the user to
// unlock) cannot tell the duress flag was tripped.
//
// Verification is INTENTIONALLY checked AFTER the real unlock fails:
//
//   1. User enters password.
//   2. messaging.unlockWallet(password) runs first.
//   3. If it succeeds → real wallet unlocks, duress check is skipped.
//   4. If it throws InvalidPasswordError → compare the entered string
//      against the stored duress hash. If matched, arm panic mode and
//      surface the same UI a normal wrong password produces. If not
//      matched, treat it as a normal wrong password (lockout
//      increments).
//
// This ordering means a duress passphrase that happens to collide with
// the real password is effectively a no-op (the real wallet unlocks
// first); it also means a successful real unlock costs zero extra
// hashing.
//
// Storage shape (localStorage `xchain-wallet:duress`):
//   { salt: base64, hash: base64, createdAt: number }
//
// `hash = sha256(salt || passphrase_utf8)`. SHA-256 is sufficient
// because:
//   1. Verification only runs AFTER the real wallet KDF already
//      rejected the input — i.e., after the user already chose to type
//      a password.
//   2. Offline attacks on the duress hash from a stolen localStorage
//      blob aren't a meaningful threat — anyone with localStorage
//      already has the encrypted wallet vault to attack instead.
//
// The stored hash never leaves localStorage; the plaintext duress
// passphrase is never persisted.

import { sha256 } from '@noble/hashes/sha2';
import { activatePanicMode } from './panicMode.js';

const STORAGE_KEY = 'xchain-wallet:duress';

let memoryFallback = null;

export class DuressNotConfiguredError extends Error {
    constructor() {
        super('duressPassphrase: no duress passphrase has been configured');
        this.name = 'DuressNotConfiguredError';
    }
}

function getStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch (_err) { /* ignore */ }
    return null;
}

function readRecord() {
    const store = getStorage();
    if (!store) return memoryFallback ? { ...memoryFallback } : null;
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            !parsed
            || typeof parsed.salt !== 'string'
            || typeof parsed.hash !== 'string'
        ) {
            return null;
        }
        return parsed;
    } catch (_err) {
        return null;
    }
}

function writeRecord(record) {
    const store = getStorage();
    if (!store) {
        memoryFallback = record ? { ...record } : null;
        return;
    }
    try {
        if (record === null) {
            store.removeItem(STORAGE_KEY);
        } else {
            store.setItem(STORAGE_KEY, JSON.stringify(record));
        }
    } catch (_err) {
        memoryFallback = record ? { ...record } : null;
    }
}

function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa === 'function') return btoa(bin);
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

function hashWithSalt(saltBytes, passphrase) {
    const passBytes = new TextEncoder().encode(passphrase);
    const buf = new Uint8Array(saltBytes.length + passBytes.length);
    buf.set(saltBytes, 0);
    buf.set(passBytes, saltBytes.length);
    return sha256(buf);
}

/** Constant-time comparison of two equal-length Uint8Arrays. */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
}

/** @returns {boolean} */
export function isDuressConfigured() {
    return readRecord() !== null;
}

/**
 * Set the duress passphrase. The plaintext is hashed with a fresh
 * 16-byte salt and never persisted.
 *
 * @param {string} passphrase
 */
export function setDuressPassphrase(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
        throw new Error('setDuressPassphrase: passphrase is required');
    }
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const hash = hashWithSalt(salt, passphrase);
    writeRecord({
        salt: bytesToBase64(salt),
        hash: bytesToBase64(hash),
        createdAt: Date.now(),
    });
}

/** Discard the stored duress passphrase. */
export function clearDuressPassphrase() {
    writeRecord(null);
    memoryFallback = null;
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
export function isDuressMatch(candidate) {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    const record = readRecord();
    if (!record) return false;
    try {
        const salt = base64ToBytes(record.salt);
        const stored = base64ToBytes(record.hash);
        const computed = hashWithSalt(salt, candidate);
        return constantTimeEqual(stored, computed);
    } catch (_err) {
        return false;
    }
}

/**
 * Check whether `candidate` is the configured duress passphrase. If it
 * is, immediately arm panic mode (24-hour default) and return true so
 * the caller can present a normal-looking wrong-password UX without
 * leaking that the duress flag fired. If it isn't, return false.
 *
 * @param {string} candidate
 * @returns {boolean}
 */
export function tripDuressIfMatch(candidate) {
    if (!isDuressMatch(candidate)) return false;
    activatePanicMode();
    return true;
}
