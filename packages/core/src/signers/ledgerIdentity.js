// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ledger device identity per coin.
//
// A Ledger has no serial the wallet can read, so a device is recognised by a
// key it derives. Each Ledger coin app is restricted to its own coin type
// (the Bitcoin app to 0', Bitcoin Test to 1', Litecoin to 2', Dogecoin to
// 3'), so no one key can be read from every app. The SignerRecord therefore
// keeps one identity per chain the device holds an account on:
//
//     identities: { [chainId]: { path, fingerprint } }
//
// `path` is the first address path the device gave for that chain and
// `fingerprint` is the first 8 bytes of SHA-256 over that address's
// compressed public key. Only the hash is stored: a SignerRecord holds no
// keys. On reconnect, the app that is open re-derives the key at the
// recorded path of a chain it serves and the hashes must match, so the
// check works from whichever app the operation needs, and a different
// device (a different seed) is refused.
//
// This module stays free of the signer packages, because the session code
// that calls it is imported by every form's bundle. The live factory reports
// which chains the open app serves (pairingInfo.chainIds).

import { sha256 } from '@noble/hashes/sha2';

const HEX = /^[0-9a-f]+$/i;

// The Ledger app each chain runs in, as the app reports its name. A copy of
// LEDGER_APP_NAME_FOR_CHAIN (signers-ledger/src/LedgerSigner.js) kept here so
// the connect flow and the sign page can name the app without loading the
// signer package; test/unit/signers/ledger-app-name.test.js holds the two equal.
const LEDGER_APP_FOR_CHAIN = Object.freeze({
    'bitcoin-mainnet': 'Bitcoin',
    'bitcoin-testnet': 'Bitcoin Test',
    'bitcoin-regtest': 'Bitcoin Test',
    'litecoin-mainnet': 'Litecoin',
    'dogecoin-mainnet': 'Dogecoin',
});

/**
 * The Ledger app a chain signs in ("Litecoin", "Bitcoin Test"), or null for a
 * chain no Ledger app serves.
 * @param {string | null | undefined} chainId
 * @returns {string | null}
 */
export function ledgerAppNameFor(chainId) {
    const key = String(chainId ?? '');
    return Object.prototype.hasOwnProperty.call(LEDGER_APP_FOR_CHAIN, key) ? LEDGER_APP_FOR_CHAIN[key] : null;
}

/**
 * The 33-byte compressed form of a secp256k1 public key, as hex. Ledger
 * answers with the 65-byte uncompressed key; the vault and the software
 * signer hold the compressed one. Both reduce to the same value here.
 *
 * @param {string} publicKeyHex
 * @returns {string}
 */
export function compressedPublicKeyHex(publicKeyHex) {
    const hex = String(publicKeyHex ?? '').replace(/^0x/i, '').toLowerCase();
    if (!HEX.test(hex)) throw new Error('ledgerIdentity: public key must be hex');
    if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) return hex;
    if (hex.length === 130 && hex.startsWith('04')) {
        const x = hex.slice(2, 66);
        const yLast = parseInt(hex.slice(-1), 16);
        return `${yLast % 2 === 1 ? '03' : '02'}${x}`;
    }
    throw new Error('ledgerIdentity: not a secp256k1 public key');
}

/**
 * The stored fingerprint of a public key: SHA-256 of its compressed form,
 * first 8 bytes, as 16 hex characters.
 *
 * @param {string} publicKeyHex
 * @returns {string}
 */
export function ledgerIdentityFingerprint(publicKeyHex) {
    const hex = compressedPublicKeyHex(publicKeyHex);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    const digest = sha256(bytes);
    let out = '';
    for (let i = 0; i < 8; i += 1) out += digest[i].toString(16).padStart(2, '0');
    return out;
}

/**
 * @param {unknown} entry
 * @returns {entry is {path: string, fingerprint: string}}
 */
export function isLedgerIdentity(entry) {
    return Boolean(entry)
        && typeof entry === 'object'
        && typeof /** @type {any} */ (entry).path === 'string'
        && /** @type {any} */ (entry).path.startsWith('m/')
        && typeof /** @type {any} */ (entry).fingerprint === 'string'
        && /^[0-9a-f]{16}$/.test(/** @type {any} */ (entry).fingerprint);
}

/**
 * One identity per chain from the accounts a device gave: the lowest
 * account index on each chain wins, then the first listed.
 *
 * @param {Array<{chainId: string, accountIndex?: number, derivationPath: string, publicKey: string}>} accounts
 * @returns {Record<string, {path: string, fingerprint: string}>}
 */
export function ledgerIdentitiesFromAccounts(accounts) {
    /** @type {Map<string, {index: number, path: string, publicKey: string}>} */
    const best = new Map();
    for (const entry of Array.isArray(accounts) ? accounts : []) {
        const chainId = entry?.chainId;
        const path = entry?.derivationPath;
        const publicKey = entry?.publicKey;
        if (typeof chainId !== 'string' || !chainId) continue;
        if (typeof path !== 'string' || !path.startsWith('m/')) continue;
        if (typeof publicKey !== 'string' || !publicKey) continue;
        const index = Number.isInteger(entry.accountIndex) ? entry.accountIndex : Number.MAX_SAFE_INTEGER;
        const held = best.get(chainId);
        if (!held || index < held.index) best.set(chainId, { index, path, publicKey });
    }
    /** @type {Record<string, {path: string, fingerprint: string}>} */
    const out = {};
    for (const [chainId, { path, publicKey }] of best) {
        try {
            out[chainId] = { path, fingerprint: ledgerIdentityFingerprint(publicKey) };
        } catch {
            // A key that is not a public key cannot identify anything; skip it.
        }
    }
    return out;
}

/**
 * The chain id of a stored Address record (`chain` is the descriptor's coin,
 * `network` its networkKind; Ledger serves only the built-in chains).
 * @param {{chain?: string, network?: string}} address
 */
function chainIdOfAddress(address) {
    return address?.chain && address?.network ? `${address.chain}-${address.network}` : null;
}

/**
 * A Ledger SignerRecord with an identity for every chain it has a stored
 * address on, keeping the identities it already holds. Covers records paired
 * before identities were stored and chains added after pairing, from the
 * addresses the device itself gave. Any other record comes back unchanged.
 *
 * @template {{id: string, vendor?: string, identities?: object}} R
 * @param {R} record
 * @param {Array<{signerId?: string|null, source?: string, chain?: string, network?: string, accountId?: string, derivationPath?: string, publicKey?: string}>} addresses
 * @returns {R}
 */
export function withLedgerIdentities(record, addresses) {
    if (record?.vendor !== 'ledger') return record;
    const own = (Array.isArray(addresses) ? addresses : [])
        .filter((a) => a?.signerId === record.id)
        .map((a) => ({
            chainId: chainIdOfAddress(a),
            accountIndex: accountIndexOfPath(a.derivationPath),
            derivationPath: a.derivationPath,
            publicKey: a.publicKey,
        }));
    const derived = ledgerIdentitiesFromAccounts(own);
    const kept = record.identities && typeof record.identities === 'object' ? record.identities : {};
    const merged = { ...derived };
    for (const [chainId, entry] of Object.entries(kept)) {
        if (isLedgerIdentity(entry)) merged[chainId] = entry;
    }
    if (!Object.keys(merged).length) return record;
    return { ...record, identities: merged };
}

/** The account field of a BIP44-shaped path (m/p'/c'/A'/...), or undefined. */
function accountIndexOfPath(path) {
    const m = /^m\/\d+'\/\d+'\/(\d+)'/.exec(String(path ?? ''));
    return m ? Number(m[1]) : undefined;
}

/**
 * Whether the device a Ledger factory just opened is the one a SignerRecord
 * was paired with, decided through the app that is open.
 *
 *   - 'same': the open app re-derived a recorded identity and it matched, or
 *     (no identity for this app) the factory's own identifier matched.
 *   - 'different': a recorded identity did not match, or a record from
 *     before per-chain identities met another device in the Bitcoin app.
 *   - 'unconfirmed': the open app serves no chain this record has an
 *     identity for, so the device cannot be checked from it.
 *
 * @param {{deviceIdentifier?: string, identities?: Record<string, {path: string, fingerprint: string}>}} record
 * @param {{signer?: any, pairingInfo?: {deviceIdentifier?: string, appName?: string, chainIds?: string[]}}} live
 * @param {{chainId?: string}} [opts]  the chain of the operation, checked first when the open app serves it
 * @returns {Promise<{verdict: 'same'|'different'|'unconfirmed', chainId?: string}>}
 */
export async function checkLedgerIdentity(record, live, { chainId } = {}) {
    const identities = record?.identities && typeof record.identities === 'object' ? record.identities : {};
    const served = Array.isArray(live?.pairingInfo?.chainIds) ? live.pairingInfo.chainIds : [];
    const candidates = Object.keys(identities)
        .filter((id) => served.includes(id) && isLedgerIdentity(identities[id]));
    if (chainId && candidates.includes(chainId)) {
        candidates.splice(candidates.indexOf(chainId), 1);
        candidates.unshift(chainId);
    }
    if (candidates.length && typeof live?.signer?.getPublicKey === 'function') {
        const id = candidates[0];
        const { path, fingerprint } = identities[id];
        const key = await live.signer.getPublicKey({ chainId: id, path });
        let found = null;
        try {
            found = ledgerIdentityFingerprint(key?.publicKey);
        } catch {
            found = null;
        }
        return { verdict: found === fingerprint ? 'same' : 'different', chainId: id };
    }
    const found = live?.pairingInfo?.deviceIdentifier;
    if (record?.deviceIdentifier && found === record.deviceIdentifier) return { verdict: 'same' };
    // A record with no identities predates them; its identifier was read in
    // the Bitcoin app, so in that app a mismatch is a different device.
    if (!Object.keys(identities).length && live?.pairingInfo?.appName === 'Bitcoin') {
        return { verdict: 'different' };
    }
    return { verdict: 'unconfirmed' };
}
