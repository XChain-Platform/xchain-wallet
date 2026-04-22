// Argon2id KDF for the wallet master key — §11.4.
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

export const KDF_KEY_LENGTH = 32;  // 256-bit master key

/**
 * @typedef {Object} KdfParams
 * @property {'argon2id'} algorithm
 * @property {string} salt               base64-encoded salt (min 16 bytes)
 * @property {number} iterations         Argon2 "t" cost
 * @property {number} memory             Argon2 "m" cost in KiB
 * @property {number} parallelism        Argon2 "p" cost
 */

/**
 * Derive a 32-byte master key from a password and the stored KDF params.
 * Returns a Uint8Array the caller is responsible for zeroing after use.
 *
 * @param {string} password
 * @param {KdfParams} params
 * @returns {Uint8Array}
 */
export function deriveMasterKey(password, params) {
    if (params.algorithm !== 'argon2id') {
        throw new Error(`kdf: unsupported algorithm "${params.algorithm}"`);
    }
    const salt = base64ToBytes(params.salt);
    if (salt.length < 8) {
        throw new Error('kdf: salt must be at least 8 bytes');
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

    let iterations = minIterations;
    let lastMs = 0;
    for (; iterations <= maxIterations; iterations++) {
        const start = performance.now();
        argon2id(probePassword, probeSalt, {
            t: iterations,
            m: memory,
            p: parallelism,
            dkLen: KDF_KEY_LENGTH,
        });
        lastMs = performance.now() - start;
        if (lastMs >= targetMs) break;
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

// Local base64 helpers — avoiding a dep for such a small surface.
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
