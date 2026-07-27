// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// pairPartner (§20.5 / Cluster W FOLLOWUP 6, ): the watcher /
// signer auto-pairing lane.
//
// THE PROBLEM
// -----------
// The air-gapped pair is two wallets restored from ONE recovery phrase:
// a `watcher` (online, builds unsigned PSBTs) and a `signer` (offline,
// signs them). Before this lane the user imported the same phrase twice
// and flipped `settings.walletMode` on each side by hand. Nothing checked
// that the two halves actually shared a seed, so the first symptom of a
// typo in the phrase was a PSBT the signer could not sign - discovered
// after the air-gap round-trip, with no diagnosis attached.
//
// THE FIX
// -------
// Each half exports a small PAIRING PAYLOAD: its account-level public
// material (publicKey + chainCode, plus the xpub when the signer can
// produce one) for every chain it has active. The halves exchange
// payloads over QR or paste, and `verifyPartnerPairing` proves they came
// from one seed by comparing the account keys on the chains they share.
// Only public material crosses the gap: no seed, no private key, and
// nothing that lets either side spend.
//
// WHAT "SAME SEED" MEANS HERE
// ---------------------------
// Two wallets restored from the same phrase derive byte-identical
// account nodes at the same path. So the comparison key is the
// account node itself, hashed into a `keyId`, and NOT the addresses:
// addresses depend on address type and network encoding, which the two
// halves may legitimately have configured differently.
//
// The check is intentionally a POSITIVE proof of shared derivation, not
// a security boundary. A payload is public and forgeable by anyone who
// already knows the wallet's xpubs; pairing with a forged payload leaks
// nothing and grants nothing, it just mislabels which device is the
// partner. What it buys is catching the mistyped phrase before the
// air-gap round-trip, which is the failure this lane exists for.
//
// ON THE WIRE
// -----------
//   XCW-PAIR:<base64url of>
//   {
//     "v": 1,
//     "kind": "xcw-partner-pairing",
//     "walletMode": "watcher" | "signer",   // the EMITTING wallet's mode
//     "label": "Cold laptop",
//     "createdAt": "2026-07-26T00:00:00.000Z",
//     "keys": [{ chainId, addressType, path, publicKey, chainCode, xpub, keyId }]
//   }
//
// `keyId` is recomputed on parse and rejected when it disagrees with its
// key material, so a truncated QR scan fails loudly instead of pairing
// against a corrupted key set.

import { sha256 } from '@noble/hashes/sha2';

export const PARTNER_PAIRING_VERSION = 1;
export const PARTNER_PAIRING_KIND = 'xcw-partner-pairing';
export const PARTNER_PAIRING_PREFIX = 'XCW-PAIR:';

// Only the two air-gapped halves pair. A `full` wallet signs and
// broadcasts on one device, so it has no partner to align with.
export const PAIRABLE_WALLET_MODES = /** @type {const} */ (['watcher', 'signer']);

// Guard against a QR frame carrying an absurd key set: 32 chains is far
// past any realistic active-chain count and keeps a hostile paste from
// pushing megabytes into the settings record.
export const PARTNER_PAIRING_MAX_KEYS = 32;
export const PARTNER_PAIRING_MAX_LABEL = 64;

const HEX_RE = /^[0-9a-f]+$/;

export class PartnerPairingError extends Error {
    /**
     * @param {string} message
     * @param {string} [reason]   machine-readable cause, mirrored onto the verification result
     */
    constructor(message, reason) {
        super(`pairPartner: ${message}`);
        this.name = 'PartnerPairingError';
        this.reason = reason || 'invalid-payload';
    }
}

/**
 * The mode the OTHER half of the pair must be in.
 *
 * @param {string | null | undefined} walletMode
 * @returns {'watcher' | 'signer' | null}   null when this wallet is not pairable
 */
export function partnerModeFor(walletMode) {
    if (walletMode === 'watcher') return 'signer';
    if (walletMode === 'signer') return 'watcher';
    return null;
}

/**
 * Copy + availability for the pairing lane, keyed off this wallet's mode.
 * One place owns the wording so the onboarding lane, the Settings entry
 * point, and the tests can't drift apart.
 *
 * @param {string | null | undefined} walletMode
 * @returns {{ available: boolean, walletMode: string, partnerMode: 'watcher' | 'signer' | null, cta: string | null, title: string | null, help: string }}
 */
export function describePairingLane(walletMode) {
    const partnerMode = partnerModeFor(walletMode);
    if (!partnerMode) {
        return {
            available: false,
            walletMode: typeof walletMode === 'string' ? walletMode : 'full',
            partnerMode: null,
            cta: null,
            title: null,
            help: 'Pairing applies to Watcher and Signer wallets. Pick one of those modes first, then pair this wallet with its other half.',
        };
    }
    const cta = partnerMode === 'signer' ? 'Pair a signer' : 'Pair a watcher';
    return {
        available: true,
        walletMode: /** @type {string} */ (walletMode),
        partnerMode,
        cta,
        title: cta,
        help: partnerMode === 'signer'
            ? 'This wallet watches your coins and builds unsigned transactions. Pair it with the offline wallet that holds the same recovery phrase and signs them.'
            : 'This wallet signs transactions offline. Pair it with the online wallet that holds the same recovery phrase and watches your coins.',
    };
}

/**
 * The account-level prefix of a derivation path: every leading hardened
 * segment. `m/84'/0'/0'/0/5` → `m/84'/0'/0'`, and a counterwallet-legacy
 * `m/0'/0/5` → `m/0'`.
 *
 * Account level is the right comparison depth: it is the deepest node
 * both halves derive identically from a shared seed regardless of which
 * receive index either one happens to have advanced to.
 *
 * @param {string} path
 * @returns {string}
 */
export function accountPathOf(path) {
    if (typeof path !== 'string' || !path.startsWith('m/')) {
        throw new PartnerPairingError(`invalid derivation path "${path}"`);
    }
    const segments = path.split('/');
    const out = ['m'];
    for (const seg of segments.slice(1)) {
        if (!seg.endsWith("'") && !seg.endsWith('h')) break;
        out.push(seg);
    }
    if (out.length === 1) {
        throw new PartnerPairingError(`path "${path}" has no hardened account prefix`);
    }
    return out.join('/');
}

/**
 * Stable id for one account node. Both halves of a correctly-seeded pair
 * compute the same id for the same chain; a different phrase (or a typo
 * in one word) changes it completely.
 *
 * @param {{ publicKey: string, chainCode: string }} key
 * @returns {string}   32-byte hex
 */
export function pairingKeyId(key) {
    const publicKey = normalizeHex(key?.publicKey, 33, 'publicKey');
    const chainCode = normalizeHex(key?.chainCode, 32, 'chainCode');
    return bytesToHex(sha256(utf8(`${publicKey}:${chainCode}`)));
}

/**
 * Display fingerprint for a whole key set. Shown side-by-side on the two
 * devices so a user can eyeball the match before trusting it. Order-
 * independent so a differing chain ORDER between halves is not read as a
 * differing seed.
 *
 * @param {Array<{ chainId: string, keyId: string }>} keys
 * @returns {string}   32-byte hex
 */
export function keySetIdOf(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
        throw new PartnerPairingError('keySetIdOf: keys must be a non-empty array');
    }
    const parts = keys
        .map((k) => `${String(k?.chainId)}|${String(k?.keyId).toLowerCase()}`)
        .sort();
    return bytesToHex(sha256(utf8(parts.join('\n'))));
}

/**
 * Read this wallet's account-level public material for a set of chains.
 *
 * Works against any Signer: `getPublicKey` is on the base interface, and
 * `getAccountXpub` is feature-detected (software signers have it;
 * hardware signers surface their xpub through their own transport, so
 * their entries carry a null xpub and pair on publicKey + chainCode).
 *
 * @param {object} opts
 * @param {{ getPublicKey: (p: { path: string }) => Promise<{ publicKey: string, chainCode: string }>, getAccountXpub?: (p: { path: string }) => Promise<string> }} opts.signer
 * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
 * @param {string[]} opts.chainIds
 * @param {number} [opts.accountIndex]
 * @param {'bip39' | 'counterwallet-legacy' | 'wif-only'} [opts.format]
 * @returns {Promise<Array<{ chainId: string, addressType: string, path: string, publicKey: string, chainCode: string, xpub: string | null, keyId: string }>>}
 */
export async function collectPairingKeys({
    signer,
    chainRegistry,
    chainIds,
    accountIndex = 0,
    format = 'bip39',
}) {
    if (!signer || typeof signer.getPublicKey !== 'function') {
        throw new PartnerPairingError('collectPairingKeys: an unlocked signer is required');
    }
    if (!chainRegistry) {
        throw new PartnerPairingError('collectPairingKeys: chainRegistry is required');
    }
    if (!Array.isArray(chainIds) || chainIds.length === 0) {
        throw new PartnerPairingError('collectPairingKeys: chainIds must be a non-empty array');
    }

    const keys = [];
    const seenPaths = new Set();
    for (const chainId of chainIds) {
        const descriptor = chainRegistry.descriptorFor
            ? chainRegistry.descriptorFor(chainId)
            : chainRegistry.get(chainId);
        if (!descriptor) continue;
        const addressType = descriptor.defaultAddressType;
        const fullPath = chainRegistry.derivationPathFor(
            chainId, addressType, accountIndex, 0, 0, { format },
        );
        if (!fullPath) continue;
        const path = accountPathOf(fullPath);
        // A counterwallet-legacy wallet collapses every chain onto one
        // `m/0'` account, and mainnet/testnet variants of a coin can share
        // a coin-type. Emitting the same node twice would inflate the key
        // set without adding evidence, so keep the first chain that
        // reaches each path.
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);

        const pub = await signer.getPublicKey({ path });
        const publicKey = normalizeHex(pub?.publicKey, 33, 'publicKey');
        const chainCode = normalizeHex(pub?.chainCode, 32, 'chainCode');
        let xpub = null;
        if (typeof signer.getAccountXpub === 'function') {
            xpub = await signer.getAccountXpub({ path });
        }
        keys.push({
            chainId,
            addressType,
            path,
            publicKey,
            chainCode,
            xpub: typeof xpub === 'string' && xpub.length > 0 ? xpub : null,
            keyId: pairingKeyId({ publicKey, chainCode }),
        });
    }
    if (keys.length === 0) {
        throw new PartnerPairingError(
            'collectPairingKeys: none of the requested chains resolved a derivation path',
            'no-derivable-chains',
        );
    }
    return keys;
}

/**
 * Assemble the payload this wallet hands to its partner.
 *
 * @param {object} opts
 * @param {'watcher' | 'signer'} opts.walletMode
 * @param {Array<object>} opts.keys
 * @param {string} [opts.label]
 * @param {string} [opts.createdAt]   ISO timestamp; defaults to now
 * @returns {object}
 */
export function buildPairingPayload({ walletMode, keys, label = '', createdAt }) {
    if (!PAIRABLE_WALLET_MODES.includes(/** @type {any} */ (walletMode))) {
        throw new PartnerPairingError(
            `walletMode "${walletMode}" cannot pair; set the wallet to watcher or signer first`,
            'not-pairable',
        );
    }
    return validatePairingPayload({
        v: PARTNER_PAIRING_VERSION,
        kind: PARTNER_PAIRING_KIND,
        walletMode,
        label: String(label || '').slice(0, PARTNER_PAIRING_MAX_LABEL),
        createdAt: createdAt || new Date().toISOString(),
        keys,
    });
}

/**
 * Validate + normalize a payload (built locally or parsed off the wire).
 * Returns a fresh object; never mutates the input.
 *
 * @param {unknown} value
 * @returns {object}
 */
export function validatePairingPayload(value) {
    if (!value || typeof value !== 'object') {
        throw new PartnerPairingError('payload must be an object');
    }
    const p = /** @type {any} */ (value);
    if (p.v !== PARTNER_PAIRING_VERSION) {
        throw new PartnerPairingError(
            `unsupported payload version "${p.v}" (expected ${PARTNER_PAIRING_VERSION})`,
            'unsupported-version',
        );
    }
    if (p.kind !== PARTNER_PAIRING_KIND) {
        throw new PartnerPairingError(`unknown payload kind "${p.kind}"`);
    }
    if (!PAIRABLE_WALLET_MODES.includes(p.walletMode)) {
        throw new PartnerPairingError(
            `payload walletMode "${p.walletMode}" must be watcher or signer`,
            'not-pairable',
        );
    }
    if (!Array.isArray(p.keys) || p.keys.length === 0) {
        throw new PartnerPairingError('payload.keys must be a non-empty array');
    }
    if (p.keys.length > PARTNER_PAIRING_MAX_KEYS) {
        throw new PartnerPairingError(
            `payload.keys carries ${p.keys.length} entries (max ${PARTNER_PAIRING_MAX_KEYS})`,
        );
    }

    const seenChains = new Set();
    const keys = p.keys.map((k, i) => {
        if (!k || typeof k !== 'object') {
            throw new PartnerPairingError(`payload.keys[${i}] must be an object`);
        }
        if (typeof k.chainId !== 'string' || k.chainId.length === 0) {
            throw new PartnerPairingError(`payload.keys[${i}].chainId must be a non-empty string`);
        }
        if (seenChains.has(k.chainId)) {
            throw new PartnerPairingError(`payload.keys carries chainId "${k.chainId}" twice`);
        }
        seenChains.add(k.chainId);
        const publicKey = normalizeHex(k.publicKey, 33, `keys[${i}].publicKey`);
        const chainCode = normalizeHex(k.chainCode, 32, `keys[${i}].chainCode`);
        const expectedId = pairingKeyId({ publicKey, chainCode });
        // A truncated / re-assembled QR scan is the realistic corruption
        // here. Recomputing the id turns that into a loud parse failure
        // rather than a pairing against half a key set.
        if (typeof k.keyId === 'string' && k.keyId.toLowerCase() !== expectedId) {
            throw new PartnerPairingError(
                `payload.keys[${i}].keyId does not match its key material; the payload is truncated or corrupt`,
                'corrupt-payload',
            );
        }
        return {
            chainId: k.chainId,
            addressType: typeof k.addressType === 'string' ? k.addressType : '',
            path: accountPathOf(typeof k.path === 'string' ? k.path : ''),
            publicKey,
            chainCode,
            xpub: typeof k.xpub === 'string' && k.xpub.length > 0 ? k.xpub : null,
            keyId: expectedId,
        };
    });

    return {
        v: PARTNER_PAIRING_VERSION,
        kind: PARTNER_PAIRING_KIND,
        walletMode: p.walletMode,
        label: typeof p.label === 'string' ? p.label.slice(0, PARTNER_PAIRING_MAX_LABEL) : '',
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date(0).toISOString(),
        keys,
    };
}

/**
 * Serialize a payload for QR display / clipboard hand-off.
 *
 * @param {object} payload
 * @returns {string}
 */
export function encodePairingPayload(payload) {
    const validated = validatePairingPayload(payload);
    return PARTNER_PAIRING_PREFIX + bytesToBase64Url(utf8(JSON.stringify(validated)));
}

/**
 * Parse a scanned / pasted payload. Accepts the prefixed base64url form
 * this wallet emits and bare JSON, since a user copying between two
 * devices by hand will sometimes move the JSON itself.
 *
 * @param {string} text
 * @returns {object}
 */
export function parsePairingPayload(text) {
    if (typeof text !== 'string' || text.trim().length === 0) {
        throw new PartnerPairingError('nothing to parse: paste or scan the partner wallet\'s pairing code');
    }
    const trimmed = text.trim();
    let json;
    if (trimmed.startsWith('{')) {
        json = trimmed;
    } else {
        const body = trimmed.startsWith(PARTNER_PAIRING_PREFIX)
            ? trimmed.slice(PARTNER_PAIRING_PREFIX.length)
            : trimmed;
        try {
            json = new TextDecoder().decode(base64UrlToBytes(body.replace(/\s+/g, '')));
        } catch (err) {
            throw new PartnerPairingError(
                `could not decode the pairing code: ${/** @type {any} */ (err)?.message || err}`,
            );
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (err) {
        throw new PartnerPairingError(
            `could not read the pairing code: ${/** @type {any} */ (err)?.message || err}`,
        );
    }
    return validatePairingPayload(parsed);
}

/**
 * Prove the two halves came from one seed.
 *
 * Returns a report rather than throwing: every failure mode here is a
 * thing the user has to see and act on (wrong mode, wrong phrase, no
 * overlapping chains), so the UI needs the reason, not a stack.
 *
 * @param {object} opts
 * @param {object} opts.local     this wallet's payload
 * @param {object} opts.partner   the payload received from the other half
 * @returns {{ ok: boolean, reason: string | null, message: string, sharedChainIds: string[], mismatchedChainIds: string[], localKeySetId: string, partnerKeySetId: string }}
 */
export function verifyPartnerPairing({ local, partner }) {
    const l = validatePairingPayload(local);
    const p = validatePairingPayload(partner);
    const localKeySetId = keySetIdOf(l.keys);
    const partnerKeySetId = keySetIdOf(p.keys);
    const base = { localKeySetId, partnerKeySetId, sharedChainIds: [], mismatchedChainIds: [] };

    const expectedPartnerMode = partnerModeFor(l.walletMode);
    if (p.walletMode !== expectedPartnerMode) {
        return {
            ...base,
            ok: false,
            reason: 'mode-mismatch',
            message: `This wallet is in ${l.walletMode} mode, so its partner must be in ${expectedPartnerMode} mode. The wallet you scanned is in ${p.walletMode} mode.`,
        };
    }

    // Compare on account paths, not chain ids: the two halves may have
    // different chains switched on, but a shared seed still produces the
    // same account node wherever their paths coincide. Falling back to
    // chain ids would call a legitimate pair "no shared chains" whenever
    // the offline half has fewer chains enabled.
    const byPath = new Map(l.keys.map((k) => [k.path, k]));
    const shared = [];
    const mismatched = [];
    for (const pk of p.keys) {
        const lk = byPath.get(pk.path);
        if (!lk) continue;
        if (lk.keyId === pk.keyId) shared.push(pk.chainId);
        else mismatched.push(pk.chainId);
    }

    if (shared.length === 0 && mismatched.length === 0) {
        return {
            ...base,
            ok: false,
            reason: 'no-shared-chains',
            message: 'The two wallets have no chain in common, so there is nothing to compare. Switch on at least one matching chain in both wallets and try again.',
        };
    }
    if (mismatched.length > 0) {
        return {
            ...base,
            ok: false,
            reason: 'seed-mismatch',
            sharedChainIds: shared,
            mismatchedChainIds: mismatched,
            message: `These two wallets were made from different recovery phrases (${mismatched.join(', ')} does not match). Restore both halves from the same phrase and pair again.`,
        };
    }
    return {
        ...base,
        ok: true,
        reason: null,
        sharedChainIds: shared,
        mismatchedChainIds: [],
        message: `Paired. Both wallets come from the same recovery phrase and agree on ${shared.length} chain${shared.length === 1 ? '' : 's'}.`,
    };
}

/**
 * The record persisted at `settings.partnerPairing`. Holds the PARTNER's
 * public key set: for a watcher wallet that set is exactly the source
 * material its unsigned PSBTs are built against.
 *
 * @param {object} opts
 * @param {object} opts.partner
 * @param {object} opts.verification
 * @param {string} [opts.pairedAt]
 * @returns {object}
 */
export function toPartnerPairingRecord({ partner, verification, pairedAt }) {
    const p = validatePairingPayload(partner);
    if (!verification || verification.ok !== true) {
        throw new PartnerPairingError(
            'refusing to store an unverified pairing',
            verification?.reason || 'unverified',
        );
    }
    return {
        walletMode: p.walletMode,
        label: p.label,
        keySetId: keySetIdOf(p.keys),
        keys: p.keys,
        sharedChainIds: [...verification.sharedChainIds],
        pairedAt: pairedAt || new Date().toISOString(),
    };
}

/**
 * One-call pairing: parse what the partner handed over, verify it against
 * this wallet's payload, and produce the settings patch to persist.
 *
 * Throws (rather than returning `ok: false`) so a host route reports a
 * failed pairing as an error the shell already knows how to surface;
 * callers that want the structured report call `verifyPartnerPairing`.
 *
 * @param {object} opts
 * @param {object} opts.local                this wallet's payload
 * @param {string | object} opts.partner     scanned/pasted text, or an already-parsed payload
 * @param {string} [opts.pairedAt]
 * @returns {{ verification: object, record: object, patch: { partnerPairing: object } }}
 */
export function pairPartner({ local, partner, pairedAt }) {
    const partnerPayload = typeof partner === 'string'
        ? parsePairingPayload(partner)
        : validatePairingPayload(partner);
    const verification = verifyPartnerPairing({ local, partner: partnerPayload });
    if (!verification.ok) {
        throw new PartnerPairingError(verification.message, verification.reason || 'unverified');
    }
    const record = toPartnerPairingRecord({ partner: partnerPayload, verification, pairedAt });
    return { verification, record, patch: { partnerPairing: record } };
}

/**
 * @param {{ partnerPairing?: object | null } | null | undefined} settings
 * @returns {object | null}
 */
export function partnerPairingOf(settings) {
    const record = settings && settings.partnerPairing;
    return record && typeof record === 'object' ? record : null;
}

/** @param {{ partnerPairing?: object | null } | null | undefined} settings */
export function isPartnerPaired(settings) {
    return partnerPairingOf(settings) !== null;
}

/**
 * The partner's account keys, i.e. a watcher wallet's source-address set.
 *
 * @param {{ partnerPairing?: object | null } | null | undefined} settings
 * @returns {Array<object>}
 */
export function partnerPairingSourceKeys(settings) {
    const record = partnerPairingOf(settings);
    return record && Array.isArray(record.keys) ? record.keys : [];
}

// --- small local helpers ----------------------------------------------

function normalizeHex(value, byteLength, label) {
    if (typeof value !== 'string') {
        throw new PartnerPairingError(`${label} must be a hex string`);
    }
    const lower = value.toLowerCase();
    if (!HEX_RE.test(lower) || lower.length !== byteLength * 2) {
        throw new PartnerPairingError(`${label} must be ${byteLength}-byte hex`);
    }
    return lower;
}

function utf8(str) {
    return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}

function bytesToBase64Url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(binary, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('binary');
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
}
