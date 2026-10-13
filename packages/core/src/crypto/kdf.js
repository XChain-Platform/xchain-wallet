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
//
// The mobile shells register a native Argon2id (setNativeArgon2id) that
// computes the same bytes many times faster; the JS implementation below
// stays the reference and the fallback for every failure.

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
 * Synchronous and JS-only; async callers use `deriveMasterKeyAsync`.
 *
 * @param {string} password
 * @param {KdfParams} params
 * @returns {Uint8Array}
 */
export function deriveMasterKey(password, params) {
    return deriveWithJs(password, checkedSalt(params), params);
}

/** Validate params (the DoS ceilings) and return the decoded salt bytes. */
function checkedSalt(params) {
    validateKdfParams(params);
    const salt = base64ToBytes(params.salt);
    if (salt.length < KDF_MIN_SALT_BYTES) {
        throw new KdfParamError(`salt must be at least ${KDF_MIN_SALT_BYTES} bytes`);
    }
    return salt;
}

/** The reference derivation every stored wallet was encrypted with. */
function deriveWithJs(password, salt, params) {
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
 * A native Argon2id, or null for the JS one. Called with
 * { password, salt: base64, iterations, memoryKib, parallelism, length } and
 * resolving the derived key as standard base64 (the XChainVault contract).
 * @typedef {(req: {password: string, salt: string, iterations: number, memoryKib: number, parallelism: number, length: number}) => Promise<string>} NativeArgon2id
 */

/** @type {NativeArgon2id | null} */
let nativeArgon2id = null;
/** @type {{ provider: NativeArgon2id, verdict: Promise<boolean> } | null} */
let nativeCheck = null;

// Known answer the JS implementation produces for these inputs. A native
// build must reproduce it before any wallet key goes through it: a wrong
// 32-byte key would seal a wallet no other device can open. Small params
// keep the check cheap; the non-ASCII password and p=2 cover the risky parts.
const NATIVE_KNOWN_ANSWER = Object.freeze({
    password: 'kat-p\u00e4ss \u2713 \u9375',
    salt: 'a2RmLWthdDE=',
    iterations: 2,
    memoryKib: 8192,
    parallelism: 2,
    length: KDF_KEY_LENGTH,
    keyBase64: '7OeLFLzPZZlGH7yt0gWieO0LVGA7YCWRFqfI14qQgk4=',
});

/**
 * Register (or with null, remove) the native Argon2id. Only the native mobile
 * shell registers one; every other runtime keeps the JS implementation.
 *
 * @param {NativeArgon2id | null} fn
 */
export function setNativeArgon2id(fn) {
    if (fn !== null && typeof fn !== 'function') {
        throw new TypeError('setNativeArgon2id: expected a function or null');
    }
    nativeArgon2id = fn;
    // Unregistering ends the provider lifecycle, so a later registration
    // proves its own known answer even when it reuses a wrapper function.
    if (fn === null) nativeCheck = null;
}

/** @returns {boolean} true when a native Argon2id is registered. */
export function hasNativeArgon2id() {
    return nativeArgon2id !== null;
}

/**
 * One provider call, reduced to "exactly `length` key bytes or null". Any
 * rejection, non-string reply or wrong length is null, so the caller falls
 * back. The reply string cannot be zeroed (a JS string); the bytes can.
 */
async function callNative(provider, request) {
    let reply;
    try {
        reply = await provider(request);
    } catch {
        return null;
    }
    if (typeof reply !== 'string') return null;
    let bytes;
    try {
        bytes = base64ToBytes(reply);
    } catch {
        return null;
    }
    if (bytes.length !== request.length) {
        bytes.fill(0);
        return null;
    }
    return bytes;
}

/**
 * Has this provider reproduced the known answer? Asked once per provider
 * function and remembered, so an older plugin without the method costs one rejected
 * call per session rather than one per derivation.
 */
function nativeVerified(provider) {
    if (nativeCheck === null || nativeCheck.provider !== provider) {
        const { keyBase64, ...request } = NATIVE_KNOWN_ANSWER;
        const verdict = callNative(provider, request).then((bytes) => {
            if (bytes === null) return false;
            const ok = bytesToBase64(bytes) === keyBase64;
            bytes.fill(0);
            return ok;
        });
        nativeCheck = { provider, verdict };
    }
    return nativeCheck.verdict;
}

/** The registered provider once it has passed the known answer, else null. */
async function verifiedNative() {
    const provider = nativeArgon2id;
    if (provider === null) return null;
    return (await nativeVerified(provider)) ? provider : null;
}

/**
 * Async `deriveMasterKey`: same validation, same bytes, native speed where
 * the shell registered a provider. Params are validated BEFORE the provider
 * sees them, so the load-time ceilings guard the native side too. Any
 * provider failure falls back to the JS derivation, so the result never
 * depends on which implementation ran. Caller zeroes the returned key.
 *
 * @param {string} password
 * @param {KdfParams} params
 * @returns {Promise<Uint8Array>}
 */
export async function deriveMasterKeyAsync(password, params) {
    const salt = checkedSalt(params);
    const provider = typeof password === 'string' ? await verifiedNative() : null;
    if (provider !== null) {
        const key = await callNative(provider, {
            password,
            salt: bytesToBase64(salt),
            iterations: params.iterations,
            memoryKib: params.memory,
            parallelism: params.parallelism,
            length: KDF_KEY_LENGTH,
        });
        if (key !== null) return key;
    }
    return deriveWithJs(password, salt, params);
}

/**
 * Take a private copy of a caller's already-derived master key. The
 * caller keeps ownership of its buffer and zeroes it; the receiver zeroes
 * the copy. The type check runs first because `new Uint8Array(32)` turns
 * a stray number into an all-zero key that would still pass the AEAD
 * length check.
 *
 * @param {Uint8Array} masterKey  KDF_KEY_LENGTH bytes, owned by the caller
 * @returns {Uint8Array} a fresh copy the receiver must zero
 */
export function copyMasterKey(masterKey) {
    if (!(masterKey instanceof Uint8Array) || masterKey.length !== KDF_KEY_LENGTH) {
        throw new Error(`masterKey must be a ${KDF_KEY_LENGTH}-byte Uint8Array`);
    }
    return new Uint8Array(masterKey);
}

/**
 * Whether two KdfParams derive the same key from the same password: same
 * algorithm, same salt BYTES, same iterations, memory and parallelism. A
 * caller that already holds the key for `a` may reuse it for `b` only when
 * this is true. Salts compare decoded, so two encodings of one salt match.
 * Any malformed input is "not equal", never a throw: the caller then derives
 * normally and the derivation reports the bad params itself.
 *
 * @param {KdfParams | null | undefined} a
 * @param {KdfParams | null | undefined} b
 * @returns {boolean}
 */
export function kdfParamsEqual(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (a.algorithm !== b.algorithm
        || a.iterations !== b.iterations
        || a.memory !== b.memory
        || a.parallelism !== b.parallelism) {
        return false;
    }
    if (typeof a.salt !== 'string' || typeof b.salt !== 'string') return false;
    let saltA;
    let saltB;
    try {
        saltA = base64ToBytes(a.salt);
        saltB = base64ToBytes(b.salt);
    } catch {
        return false;
    }
    if (saltA.length === 0 || saltA.length !== saltB.length) return false;
    for (let i = 0; i < saltA.length; i += 1) {
        if (saltA[i] !== saltB[i]) return false;
    }
    return true;
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
 * Pick the `iterations` that hits `targetMs` on this device, holding
 * memory and parallelism fixed. Called once at wallet creation to
 * populate per-device params.
 *
 * Argon2id time is linear in its pass count, so one single-pass probe is
 * enough to size the real run. Probing at the full floor instead cost a
 * whole extra KDF on slow phones, where the floor alone overshoots the
 * target: about a third of the two-minute wallet creation on an LG K51
 * (2026-10-12).
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

    const start = performance.now();
    argon2id(probePassword, probeSalt, {
        t: 1,
        m: memory,
        p: parallelism,
        dkLen: KDF_KEY_LENGTH,
    });
    const msPerPass = performance.now() - start;

    return calibratedParams(
        sizeIterations(msPerPass, targetMs, minIterations, maxIterations),
        memory,
        parallelism,
    );
}

// Most passes a native-timed calibration may choose. The stored params must
// stay openable by the JS fallback wherever the wallet travels (a backup
// restored on desktop, web or the extension, which have no provider). JS
// runs about 0.64 s per pass at 64 MiB on a fast desktop (measured
// 2026-10-12), so 4 passes cost about 2.6 s there: inside 3x the 1 s target.
// A phone's own JS fallback already exceeds that bound at the floor (an
// LG K51 runs about 13 s per pass), so no ceiling can bound it; the floor
// rules there, and this ceiling only stops native speed from adding passes
// the JS side would pay for.
export const KDF_NATIVE_CALIBRATION_MAX_ITERATIONS = 4;

/**
 * `calibrateKdfParams` timed against the native Argon2id when one is
 * registered, so a phone sizes the work against the code that will run it.
 * Same single-pass probe; the result is capped at
 * KDF_NATIVE_CALIBRATION_MAX_ITERATIONS (see above). With no provider, or a
 * provider that fails its check or the probe, this is `calibrateKdfParams`.
 *
 * @param {Parameters<typeof calibrateKdfParams>[0]} [opts]
 * @returns {Promise<KdfParams>}
 */
export async function calibrateKdfParamsAsync(opts = {}) {
    const provider = await verifiedNative();
    if (provider === null) return calibrateKdfParams(opts);
    const targetMs = opts.targetMs ?? 1000;
    const memory = opts.memory ?? KDF_MIN_MEMORY_KIB;
    const parallelism = opts.parallelism ?? KDF_DEFAULT_PARALLELISM;
    const minIterations = opts.minIterations ?? KDF_MIN_ITERATIONS;
    const maxIterations = opts.maxIterations ?? 32;
    const ceiling = Math.max(
        minIterations,
        Math.min(maxIterations, KDF_NATIVE_CALIBRATION_MAX_ITERATIONS),
    );

    const probeSalt = new Uint8Array(16);
    crypto.getRandomValues(probeSalt);
    const start = performance.now();
    const probeKey = await callNative(provider, {
        password: 'calibration-probe',
        salt: bytesToBase64(probeSalt),
        iterations: 1,
        memoryKib: memory,
        parallelism,
        length: KDF_KEY_LENGTH,
    });
    const msPerPass = performance.now() - start;
    if (probeKey === null) return calibrateKdfParams(opts);
    probeKey.fill(0);

    return calibratedParams(
        sizeIterations(msPerPass, targetMs, minIterations, ceiling),
        memory,
        parallelism,
    );
}

/** Passes that meet `targetMs` at `msPerPass`, clamped to [min, max]. */
function sizeIterations(msPerPass, targetMs, minIterations, maxIterations) {
    // A probe too fast for the clock to see says nothing about scale: it
    // meets a zero target and can never meet a positive one.
    let iterations;
    if (msPerPass > 0) iterations = Math.ceil(targetMs / msPerPass);
    else iterations = targetMs > 0 ? maxIterations : minIterations;
    return Math.min(maxIterations, Math.max(minIterations, iterations));
}

/** Fresh-salted params at the calibrated cost. */
function calibratedParams(iterations, memory, parallelism) {
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
