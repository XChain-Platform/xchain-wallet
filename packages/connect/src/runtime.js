// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: MIT

// Runtime values stay in plain JavaScript because the desktop main process
// loads this package unbundled from node_modules, where Node does not strip
// TypeScript. index.ts re-exports them for the typed public entry point.

// Semver for the request protocol, independent of wallet version.
export const PROTOCOL_VERSION = '0.2.0';
/** @type {readonly string[]} */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['0.1.0', '0.2.0']);

// Semver for the injected bridge protocol itself, independent of wallet version.
// Minor bumps are additive (new methods); major bumps are breaking.
// Maintained by hand. It deliberately does not track the package release
// version. Update the supported list with protocol changes.
export const BRIDGE_SPEC_VERSION = '0.1.0';

// Cluster F FOLLOWUP 3 - version negotiation. Versions a wallet
// claiming to implement BRIDGE_SPEC_VERSION can speak. dApps requesting
// a version outside this list get a clean BRIDGE_VERSION_MISMATCH from
// `connect`, instead of a generic error when they later call a method
// the wallet doesn't recognize.
//
// Today we ship one supported version (0.1.0). When 0.2.0 lands and the
// wallet supports both, this becomes ['0.1.0', '0.2.0']. When 0.1.0 is
// retired, drop it.
/** @type {readonly string[]} */
export const BRIDGE_SUPPORTED_VERSIONS = ['0.1.0'];

/**
 * @param {unknown} requested
 * @returns {boolean} true when at least one supported version satisfies the
 * requested RANGE. `ConnectOpts.requiredBridgeVersion` is specified as a semver
 * range ('^0.1.0'), not an exact version, so exact-string matching refused every
 * compatible dApp that wrote its requirement the documented way.
 * Empty / non-string requests pass through (the connect handler falls back to
 * BRIDGE_SPEC_VERSION as the assumed version).
 *
 * Ranges are matched in-package rather than through `semver`: bridge-spec is the
 * dependency-free contract third parties import, and the grammar a bridge
 * version needs is small.
 */
export function isBridgeVersionSupported(requested) {
    if (typeof requested !== 'string' || requested.length === 0) return true;
    const range = requested.trim();
    if (range === '*' || range === 'x') return true;
    return BRIDGE_SUPPORTED_VERSIONS.some((version) => satisfiesRange(version, range));
}

/** Parse 'MAJOR.MINOR.PATCH' (prerelease/build suffixes ignored). */
function parseVersion(value) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 / 0 / 1, comparing two parsed version triples. */
function compareVersions(a, b) {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

/**
 * Match one concrete version against one range. Supported grammar: exact,
 * `^` (caret, 0.x-aware: the leftmost non-zero component is the one pinned),
 * `~` (patch-level), and the `>= > <= <` comparators. Whitespace- or
 * comma-separated terms are ANDed; `||` alternatives are ORed. As in semver,
 * an operator may be separated from its version by whitespace (`>= 0.1.0`).
 * An unparseable range fails closed, which surfaces as BRIDGE_VERSION_MISMATCH
 * rather than a silent accept.
 */
function satisfiesRange(version, range) {
    const target = parseVersion(version);
    if (!target) return false;
    return range.split('||').some((alternative) => {
        // Bind an operator to the version after it before splitting into terms.
        // Only an operator that starts a term is joined, and only onto a
        // version-shaped token, so a dangling operator or one trailing a
        // version stays its own malformed term and fails closed.
        const bound = alternative.replace(/(^|[\s,])(\^|~|>=|<=|>|<|=)\s+(?=v?\d)/g, '$1$2');
        const terms = bound.split(/[\s,]+/).filter(Boolean);
        if (terms.length === 0) return false;
        return terms.every((term) => satisfiesTerm(target, term));
    });
}

function satisfiesTerm(target, term) {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$/.exec(term);
    if (!m) return false;
    const operator = m[1] ?? '=';
    const bound = parseVersion(m[2]);
    if (!bound) return false;
    const cmp = compareVersions(target, bound);
    if (operator === '=') return cmp === 0;
    if (operator === '>') return cmp > 0;
    if (operator === '>=') return cmp >= 0;
    if (operator === '<') return cmp < 0;
    if (operator === '<=') return cmp <= 0;
    if (cmp < 0) return false;
    if (operator === '~') {
        return target[0] === bound[0] && target[1] === bound[1];
    }
    // Caret. Below 1.0.0 a minor bump is breaking, and below 0.1.0 a patch
    // bump is, so the pinned component is the leftmost non-zero one.
    if (bound[0] !== 0) return target[0] === bound[0];
    if (bound[1] !== 0) return target[0] === 0 && target[1] === bound[1];
    return target[0] === 0 && target[1] === 0 && target[2] === bound[2];
}

// The published BridgeErrorCode union (§43), as a RUNTIME value.
//
// `index.ts` declares the same codes as a TypeScript union. A union erases at
// build time, so nothing could consult it at run time and nothing did: the
// wallet emitted twelve internal codes the union never contained
// (CHAIN_NOT_PERMITTED, ADDRESS_NOT_PERMITTED, MISSING_ORIGIN, ...) and a dApp
// branching on `error` the way the spec tells it to fell through every case
//The wallet now maps its internal vocabulary onto this list
// before anything reaches the page, and a dApp written in plain JS can use it
// to validate a code it was handed.
//
// This array and the `BridgeErrorCode` union in index.ts are one contract in
// two syntaxes and must be edited together;
// test/unit/bridge/bridge-envelope-contract.test.js pins them to each other.
/** @type {readonly string[]} */
export const BRIDGE_ERROR_CODES = Object.freeze([
    'USER_REJECTED',
    'NOT_CONNECTED',
    'WALLET_LOCKED',
    'CHAIN_NOT_SUPPORTED',
    'ACCOUNT_NOT_AUTHORIZED',
    'ADDRESS_NOT_AUTHORIZED',
    'UNSUPPORTED_ACTION',
    'INVALID_PARAMS',
    'CHALLENGE_EXPIRED',
    'BROADCAST_FAILED',
    'PANIC_MODE',
    'THROTTLED',
    'BLOCKED_BY_USER',
    'BRIDGE_VERSION_MISMATCH',
    'BALANCES_UNAVAILABLE',
    'INTERNAL_ERROR',
]);

export const ERROR_CODES = Object.freeze([
    ...BRIDGE_ERROR_CODES,
    'REQUEST_EXPIRED',
    'REQUEST_TOO_LARGE',
    'RESULT_TOO_LARGE',
    'NO_PENDING_REQUEST',
]);

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is one of the published codes.
 */
export function isBridgeErrorCode(value) {
    return typeof value === 'string' && BRIDGE_ERROR_CODES.includes(value);
}

export function isErrorCode(value) {
    return typeof value === 'string' && ERROR_CODES.includes(value);
}

// Version of the Sign-in with XChain challenge format (§43.6).
//
// v2 (breaking): the wallet-stamped page origin is embedded in the
// signed bytes between appId and address. appId is supplied by the
// requesting page, so by itself it proves nothing about *where* the
// sign-in happened; origin is recorded by the wallet from the page
// that made the request and cannot be chosen by the dApp. Relying
// backends MUST verify the origin field - it is what lets them reject
// a challenge signed on a look-alike site that passed a legitimate
// app's appId. v1 challenges (no origin field) fail to parse and
// should be rejected.
export const LOGIN_CHALLENGE_VERSION = 2;
export const SIGN_IN_CHALLENGE_VERSION = LOGIN_CHALLENGE_VERSION;

// Default expiry window for a Sign-in challenge. Wallets refuse to sign a
// challenge whose expiresAt is in the past.
export const LOGIN_DEFAULT_EXPIRY_MS = 5 * 60 * 1000;
export const SIGN_IN_DEFAULT_EXPIRY_MS = LOGIN_DEFAULT_EXPIRY_MS;

// The wire format is:
//
//   `XChain Sign-In v2 | <appId> | <origin> | <address> | <nonce> | <timestamp> | <expiresAt>`
//
// All fields are string-serialized, separated by " | ". Pipes inside any
// field are rejected at format time - dApps must supply appId/nonce values
// that do not contain the separator. The versioned prefix lets validators
// detect the format on the wire; v1 challenges ("XChain Sign-In", no
// origin field) fail parseSignInChallenge and must be rejected.
export const LOGIN_CHALLENGE_PREFIX = 'XChain Sign-In v2';
export const LOGIN_CHALLENGE_SEPARATOR = ' | ';
export const SIGN_IN_CHALLENGE_PREFIX = LOGIN_CHALLENGE_PREFIX;
export const SIGN_IN_CHALLENGE_SEPARATOR = LOGIN_CHALLENGE_SEPARATOR;

// Expose the injection event from the plain-JS entry point so packed and
// unbundled consumers receive the TypeScript declaration barrel's runtime surface.
export const PROVIDER_READY_EVENT = 'xchain#initialized';

export function isXChainAvailable() {
    return (
        typeof globalThis !== 'undefined' &&
        'xchain' in globalThis &&
        globalThis.xchain?.isXChainWallet === true
    );
}

/**
 * Await the injected provider, or return null when the timeout expires.
 * The default gives delayed extension and iframe injection a short window.
 *
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<import('./index.ts').XChainProvider | null>}
 */
export function getProvider(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 1000;

    if (isXChainAvailable()) {
        return Promise.resolve(globalThis.xchain ?? null);
    }

    if (timeoutMs <= 0 || typeof globalThis.addEventListener !== 'function') {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            globalThis.removeEventListener(PROVIDER_READY_EVENT, onReady);
            clearTimeout(timer);
            resolve(value);
        };
        const onReady = () => finish(globalThis.xchain ?? null);
        const timer = setTimeout(() => finish(null), timeoutMs);
        globalThis.addEventListener(PROVIDER_READY_EVENT, onReady, { once: true });
        // Re-check after listener registration so an injection between the first read and registration is not lost.
        if (isXChainAvailable()) onReady();
    });
}

/**
 * Generate a cryptographically random hex nonce.
 *
 * @param {number} [byteLength]
 * @returns {string}
 */
export function generateNonce(byteLength = 16) {
    const crypto = globalThis.crypto;
    if (!crypto?.getRandomValues) {
        throw new Error('Web Crypto API is required to generate a nonce');
    }
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build login parameters with a fresh nonce and bounded expiry.
 *
 * @param {string} appId
 * @param {{expiresInMs?: number, nonce?: string}} [opts]
 * @returns {import('./index.ts').SignInParams}
 */
export function makeLoginParams(appId, opts = {}) {
    return {
        appId,
        nonce: opts.nonce ?? generateNonce(),
        expiresInMs: opts.expiresInMs ?? LOGIN_DEFAULT_EXPIRY_MS,
    };
}

export const makeSignInParams = makeLoginParams;

/**
 * Validate the signed challenge fields before a caller verifies its signature.
 * expected.origin is mandatory because the wallet stamps the requesting page's
 * origin into the challenge. A mismatch means it was signed on another site.
 *
 * @param {import('./index.ts').SignInChallengeV2} parts
 * @param {{appId: string, origin: string, nonce?: string, now?: number}} expected
 * @returns {string | null}
 */
export function validateLoginChallenge(parts, expected) {
    if (parts.version !== LOGIN_CHALLENGE_VERSION) {
        return `Unsupported challenge version: ${parts.version}`;
    }
    if (parts.appId !== expected.appId) {
        return `Challenge appId mismatch: expected ${expected.appId}, got ${parts.appId}`;
    }
    if (parts.origin !== expected.origin) {
        return `Challenge origin mismatch: expected ${expected.origin}, got ${parts.origin}`;
    }
    if (expected.nonce !== undefined && parts.nonce !== expected.nonce) {
        return 'Challenge nonce mismatch';
    }
    const now = expected.now ?? Date.now();
    if (!Number.isFinite(parts.timestamp) || parts.timestamp > now) {
        return 'Challenge timestamp is in the future';
    }
    if (!Number.isFinite(parts.expiresAt) || parts.expiresAt <= now) {
        return 'Challenge is expired';
    }
    return null;
}

export const validateSignInChallenge = validateLoginChallenge;

/**
 * @param {import('./index.ts').SignInChallengeV2} parts
 * @returns {string}
 */
export function formatLoginChallenge(parts) {
    if (parts.version !== LOGIN_CHALLENGE_VERSION) {
        throw new Error(
            `Unsupported sign-in challenge version: ${parts.version}`,
        );
    }
    const fields = [
        parts.appId,
        parts.origin,
        parts.address,
        parts.nonce,
        String(parts.timestamp),
        String(parts.expiresAt),
    ];
    for (const f of fields) {
        if (typeof f !== 'string' && typeof f !== 'number') {
            throw new Error('Sign-in challenge field has invalid type');
        }
        if (String(f).includes(LOGIN_CHALLENGE_SEPARATOR)) {
            throw new Error(
                `Sign-in challenge field contains reserved separator: ${String(f)}`,
            );
        }
    }
    return [LOGIN_CHALLENGE_PREFIX, ...fields].join(
        LOGIN_CHALLENGE_SEPARATOR,
    );
}

export const formatSignInChallenge = formatLoginChallenge;

/**
 * @param {string} challenge
 * @returns {import('./index.ts').SignInChallengeV2 | null}
 */
export function parseLoginChallenge(challenge) {
    const segments = challenge.split(LOGIN_CHALLENGE_SEPARATOR);
    if (segments.length !== 7) return null;
    const [prefix, appId, origin, address, nonce, timestampStr, expiresAtStr] =
        segments;
    if (prefix !== LOGIN_CHALLENGE_PREFIX) return null;
    const timestamp = Number(timestampStr);
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(timestamp) || !Number.isFinite(expiresAt))
        return null;
    return {
        version: 2,
        appId,
        origin,
        address,
        nonce,
        timestamp,
        expiresAt,
    };
}

export const parseSignInChallenge = parseLoginChallenge;
