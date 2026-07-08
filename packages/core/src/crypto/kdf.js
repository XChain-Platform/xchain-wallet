// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Argon2id KDF for the wallet master key (§11.4).
//
// Parameters are tuned per-device at wallet creation to target ~1s of
// work on the user's machine. The tuning helper is exported; callers
// store the resulting params alongside the ciphertext (per Wallet.kdfParams).

import { argon2id } from '@noble/hashes/argon2';

// Sane floor parameters. A 64 MiB memory cost is the minimum the IETF
// draft recommends for password hashing. `iterations = 3` and
// `parallelism = 1` are the Argon2id defaults in RFC 9106.
export const KDF_MIN_MEMORY_KIB = 64 * 1024;
export const KDF_MIN_ITERATIONS = 3;
export const KDF_DEFAULT_PARALLELISM = 1;

// Ceilings enforced on LOAD so an attacker-supplied blob (a hostile
// backup file or crafted wallet record) can't dictate an unbounded
// Argon2id cost and OOM/hang the process BEFORE the auth-tag check ever
// runs. 1 GiB is well above any legitimate per-device calibration
// (calibrateKdfParams only ever raises `iterations`, never `memory`);
// 64 iterations / 8 lanes bound the CPU grind. These are validation
// bounds, not tuning targets.
export const KDF_MAX_MEMORY_KIB = 1024 * 1024;   // 1 GiB
export const KDF_MAX_ITERATIONS = 64;
export const KDF_MAX_PARALLELISM = 8;
export const KDF_MIN_SALT_BYTES = 8;

export const KDF_KEY_LENGTH = 32;  // 256-bit master key

/**
 * @typedef {Object} KdfParams
 * @property {'argon2id'} algorithm
 * @property {string} salt               base64-encoded salt (min 16 bytes)
 * @property {number} iterations         Argon2 "t" cost
 * @property {number} memory             Argon2 "m" cost in KiB
 * @property {number} parallelism        Argon2 "p" cost
 */

export class KdfParamError extends Error {
    constructor(reason) {
        super(`kdf: ${reason}`);
        this.name = 'KdfParamError';
    }
}

const isPositiveSafeInt = (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/**
 * Validate KDF params supplied from persisted / imported data before they
 * are handed to Argon2id. This is a trust-boundary check: the params ride
 * alongside the ciphertext (a backup envelope or a Wallet record), so an
 * attacker who hands the user a file controls them and could otherwise
 * demand an unbounded memory/CPU cost that OOMs or hangs the process
 * BEFORE the AEAD tag (the actual password check) ever runs.
 *
 * Enforces positive-integer types and hard CEILINGS (the DoS defence).
 * The floors (`KDF_MIN_*`) are the defaults for freshly created wallets,
 * NOT a load-time requirement: a legitimately weak blob exists (the
 * throwaway demo wallet uses iterations=1 / memory=8 MiB for speed), so a
 * too-LOW param must still load. A weakened cost only ever weakens the
 * attacker's own copy of a stolen blob, so it is not a defence boundary;
 * the too-HIGH direction is.
 *
 * @param {KdfParams} params
 * @throws {KdfParamError}
 */
export function validateKdfParams(params) {
    if (!params || typeof params !== 'object') {
        throw new KdfParamError('params must be an object');
    }
    if (params.algorithm !== 'argon2id') {
        throw new KdfParamError(`unsupported algorithm "${params.algorithm}"`);
    }
    if (!isPositiveSafeInt(params.iterations)) {
        throw new KdfParamError('iterations must be a positive integer');
    }
    if (!isPositiveSafeInt(params.memory)) {
        throw new KdfParamError('memory must be a positive integer (KiB)');
    }
    if (!isPositiveSafeInt(params.parallelism)) {
        throw new KdfParamError('parallelism must be a positive integer');
    }
    if (params.iterations > KDF_MAX_ITERATIONS) {
        throw new KdfParamError(
            `iterations ${params.iterations} exceeds max ${KDF_MAX_ITERATIONS}`,
        );
    }
    if (params.memory > KDF_MAX_MEMORY_KIB) {
        throw new KdfParamError(
            `memory ${params.memory} KiB exceeds max ${KDF_MAX_MEMORY_KIB}`,
        );
    }
    if (params.parallelism > KDF_MAX_PARALLELISM) {
        throw new KdfParamError(
            `parallelism ${params.parallelism} exceeds max ${KDF_MAX_PARALLELISM}`,
        );
    }
}

/**
 * Derive a 32-byte master key from a password and the stored KDF params.
 * Returns a Uint8Array the caller is responsible for zeroing after use.
 *
 * @param {string} password
 * @param {KdfParams} params
 * @returns {Uint8Array}
 */
export function deriveMasterKey(password, params) {
    validateKdfParams(params);
    const salt = base64ToBytes(params.salt);
    if (salt.length < KDF_MIN_SALT_BYTES) {
        throw new KdfParamError(`salt must be at least ${KDF_MIN_SALT_BYTES} bytes`);
    }
    const passwordBytes = new TextEncoder().encode(password);
    try {
        return argon2id(passwordBytes, salt, {
            t: params.iterations,
            m: params.memory,
            p: params.parallelism,
            dkLen: KDF_KEY_LENGTH,
        });
    } finally {
        passwordBytes.fill(0);
    }
}

/**
 * Build a fresh KdfParams with a random 16-byte salt and the floor
 * tuning. Callers can override `iterations` / `memory` after measuring
 * a calibration run on the user's device.
 *
 * @param {Partial<Pick<KdfParams, 'iterations' | 'memory' | 'parallelism'>>} [overrides]
 * @returns {KdfParams}
 */
export function makeFreshKdfParams(overrides = {}) {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    return {
        algorithm: 'argon2id',
        salt: bytesToBase64(salt),
        iterations: overrides.iterations ?? KDF_MIN_ITERATIONS,
        memory: overrides.memory ?? KDF_MIN_MEMORY_KIB,
        parallelism: overrides.parallelism ?? KDF_DEFAULT_PARALLELISM,
    };
}

/**
 * Run a short calibration to find the smallest `iterations` that hits
 * `targetMs` on this device, holding memory and parallelism fixed.
 * Called once at wallet creation to populate per-device params.
 *
 * @param {Object} [opts]
 * @param {number} [opts.targetMs]       default 1000
 * @param {number} [opts.memory]         default KDF_MIN_MEMORY_KIB
 * @param {number} [opts.parallelism]    default KDF_DEFAULT_PARALLELISM
 * @param {number} [opts.minIterations]  default KDF_MIN_ITERATIONS
 * @param {number} [opts.maxIterations]  default 32
 * @returns {KdfParams}
 */
export function calibrateKdfParams(opts = {}) {
    const targetMs = opts.targetMs ?? 1000;
    const memory = opts.memory ?? KDF_MIN_MEMORY_KIB;
    const parallelism = opts.parallelism ?? KDF_DEFAULT_PARALLELISM;
    const minIterations = opts.minIterations ?? KDF_MIN_ITERATIONS;
    const maxIterations = opts.maxIterations ?? 32;

    const probeSalt = new Uint8Array(16);
    crypto.getRandomValues(probeSalt);
    const probePassword = new TextEncoder().encode('calibration-probe');

    // Increment only when we're going to probe again, so on exit `iterations`
    // holds the value actually measured, capped at maxIterations rather than
    // the post-increment maxIterations+1 a `for (; i <= max; i++)` would leave.
    let iterations = minIterations;
    let lastMs = 0;
    for (;;) {
        const start = performance.now();
        argon2id(probePassword, probeSalt, {
            t: iterations,
            m: memory,
            p: parallelism,
            dkLen: KDF_KEY_LENGTH,
        });
        lastMs = performance.now() - start;
        if (lastMs >= targetMs || iterations >= maxIterations) break;
        iterations++;
    }

    const saltOut = new Uint8Array(16);
    crypto.getRandomValues(saltOut);
    return {
        algorithm: 'argon2id',
        salt: bytesToBase64(saltOut),
        iterations,
        memory,
        parallelism,
    };
}

// Local base64 helpers (no dep needed for such a small surface).
function bytesToBase64(bytes) {
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return typeof btoa === 'function'
        ? btoa(str)
        : Buffer.from(str, 'binary').toString('base64');
}

function base64ToBytes(b64) {
    const bin =
        typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export { bytesToBase64, base64ToBytes };
