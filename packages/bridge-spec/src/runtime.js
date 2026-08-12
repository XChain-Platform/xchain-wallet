// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// THE RUNTIME HALF OF THE BRIDGE SPEC, IN PLAIN JS.
//
// Everything else in this package is types, which erase at build time and
// therefore cost a consumer nothing. These nine values do not erase, and
// one consumer loads them WITHOUT A BUNDLER: the desktop shell's Electron
// MAIN process imports `@xchain-wallet/extension/src/bridge/handlers.js`
// straight out of app.asar, and that file imports this package.
//
// While the package's only entry point was `src/index.ts`, that path ended
// in a hard crash on startup:
//
//   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING: Stripping types is
//   currently unsupported for files under node_modules, for
//   ".../node_modules/@xchain-wallet/bridge-spec/src/index.ts"
//
// Node will strip types from a first-party file but never from one inside
// node_modules, and a packed workspace package IS inside node_modules. The
// web and extension shells never saw it because Vite transpiles the .ts at
// bundle time.
//
// So the runtime values live here, in a file every consumer can load, and
// `index.ts` re-exports them so the public entry point is unchanged.
// package.json points `main` here and `types` at index.ts. The alternative
// was adding a build step to this package, which would have made every
// shell's build depend on bridge-spec being compiled first - including the
// reproducible-build container, whose build.sh deliberately builds only the
// desktop renderer. A file with no type annotations needs no build at all.

// Semver for the bridge protocol itself, independent of wallet version.
// Minor bumps are additive (new methods); major bumps are breaking.
// Kept in sync with this package's package.json version.
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
 * comma-separated terms are ANDed; `||` alternatives are ORed. An unparseable
 * range fails closed, which surfaces as BRIDGE_VERSION_MISMATCH rather than a
 * silent accept.
 */
function satisfiesRange(version, range) {
    const target = parseVersion(version);
    if (!target) return false;
    return range.split('||').some((alternative) => {
        const terms = alternative.split(/[\s,]+/).filter(Boolean);
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
// two syntaxes and must be edited together; test/unit/bridge/bridge-error-codes
// pins them to each other so a code added to one and not the other fails.
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
    'INTERNAL_ERROR',
]);

/**
 * @param {unknown} value
 * @returns {boolean} true when `value` is one of the published codes.
 */
export function isBridgeErrorCode(value) {
    return typeof value === 'string' && BRIDGE_ERROR_CODES.includes(value);
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
export const SIGN_IN_CHALLENGE_VERSION = 2;

// Default expiry window for a Sign-in challenge. Wallets refuse to sign a
// challenge whose expiresAt is in the past.
export const SIGN_IN_DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

// The wire format is:
//
//   `XChain Sign-In v2 | <appId> | <origin> | <address> | <nonce> | <timestamp> | <expiresAt>`
//
// All fields are string-serialized, separated by " | ". Pipes inside any
// field are rejected at format time - dApps must supply appId/nonce values
// that do not contain the separator. The versioned prefix lets validators
// detect the format on the wire; v1 challenges ("XChain Sign-In", no
// origin field) fail parseSignInChallenge and must be rejected.
export const SIGN_IN_CHALLENGE_PREFIX = 'XChain Sign-In v2';
export const SIGN_IN_CHALLENGE_SEPARATOR = ' | ';

/**
 * @param {import('./index.ts').SignInChallengeV2} parts
 * @returns {string}
 */
export function formatSignInChallenge(parts) {
    if (parts.version !== SIGN_IN_CHALLENGE_VERSION) {
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
        if (String(f).includes(SIGN_IN_CHALLENGE_SEPARATOR)) {
            throw new Error(
                `Sign-in challenge field contains reserved separator: ${String(f)}`,
            );
        }
    }
    return [SIGN_IN_CHALLENGE_PREFIX, ...fields].join(
        SIGN_IN_CHALLENGE_SEPARATOR,
    );
}

/**
 * @param {string} challenge
 * @returns {import('./index.ts').SignInChallengeV2 | null}
 */
export function parseSignInChallenge(challenge) {
    const segments = challenge.split(SIGN_IN_CHALLENGE_SEPARATOR);
    if (segments.length !== 7) return null;
    const [prefix, appId, origin, address, nonce, timestampStr, expiresAtStr] =
        segments;
    if (prefix !== SIGN_IN_CHALLENGE_PREFIX) return null;
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
