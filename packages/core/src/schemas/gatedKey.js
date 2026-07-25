// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// GatedKey record (PC-25, Token_Gated_Content.md). One row per gated
// pack key K this wallet holds, keyed by (walletId, chainId,
// gateTicker, keyHash). Written at publish time (issuer) or after a
// successful key-recovery scan (holder), so the key survives lock,
// restart, and, unlike the on-chain self-handoff, is reachable by
// signer types that cannot run the ECIES scan (HW / watch-only).
// Without this row an HW issuer could publish a pack once and never
// extend it: the pack key would exist only inside an ECIES envelope
// the HW signer cannot decrypt.
//
// SECRET-BEARING RECORD: `keyHex` is the raw 32-byte AES-256-GCM pack
// key. It lives here deliberately: the vault document is AEAD-
// encrypted at rest under the wallet master key (storage/codec.js),
// the same protection the seed backup pointers rely on. It must NEVER
// leave the background context: host handlers list metadata only and
// strip `keyHex` (createBackgroundHost gatedKeys.list).

import {
    check,
    isIsoTimestamp,
    isNonEmptyString,
    isPlainObject,
    result,
} from './validate.js';

export const CURRENT_VERSION = 1;

/** Sources a key can arrive from. */
export const GATED_KEY_SOURCES = ['published', 'recovered'];

/**
 * @typedef {Object} GatedKey
 * @property {1} schemaVersion
 * @property {string} id           canonical `${walletId}::${chainId}::${gateTicker}::${keyHash}`
 * @property {string} walletId
 * @property {string} chainId
 * @property {string} gateTicker
 * @property {string} keyHash      hex sha256(K), lowercased
 * @property {string} keyHex       raw 32-byte key K, hex (64 chars) - SECRET
 * @property {'published' | 'recovered'} source
 * @property {string} createdAt
 */

/** Canonical id so puts are idempotent per (wallet, chain, tick, keyHash). */
export function gatedKeyId({ walletId, chainId, gateTicker, keyHash }) {
    return `${walletId}::${chainId}::${String(gateTicker).toUpperCase()}::${String(keyHash).toLowerCase()}`;
}

/**
 * @param {Object} input
 * @param {string} input.walletId
 * @param {string} input.chainId
 * @param {string} input.gateTicker
 * @param {string} input.keyHash
 * @param {string} input.keyHex
 * @param {'published' | 'recovered'} input.source
 * @returns {GatedKey}
 */
export function createGatedKey(input) {
    return {
        schemaVersion: CURRENT_VERSION,
        id: gatedKeyId(input),
        walletId: input.walletId,
        chainId: input.chainId,
        gateTicker: String(input.gateTicker).toUpperCase(),
        keyHash: String(input.keyHash).toLowerCase(),
        keyHex: input.keyHex,
        source: input.source,
        createdAt: new Date().toISOString(),
    };
}

export function validateGatedKey(record) {
    const errors = [];
    if (!check(errors, 'gatedKey', isPlainObject(record), 'must be an object'))
        return result(errors);
    const r = /** @type {GatedKey} */ (record);
    check(errors, 'schemaVersion', r.schemaVersion === CURRENT_VERSION, `must be ${CURRENT_VERSION}`);
    check(errors, 'id', isNonEmptyString(r.id), 'must be a non-empty string');
    check(errors, 'walletId', isNonEmptyString(r.walletId), 'must be a non-empty string');
    check(errors, 'chainId', isNonEmptyString(r.chainId), 'must be a non-empty string');
    check(errors, 'gateTicker', isNonEmptyString(r.gateTicker), 'must be a non-empty string');
    // keyHash binds keyHex: both fixed-shape hex, and the hash must be
    // recomputable from the key by callers (verified at write sites via
    // sdk.gatedFile.verifyKey; the schema enforces shape only, since
    // schema validation must stay dependency-free and synchronous).
    check(errors, 'keyHash', typeof r.keyHash === 'string' && /^[0-9a-f]{64}$/.test(r.keyHash),
        'must be 64 lowercase hex chars (sha256)');
    check(errors, 'keyHex', typeof r.keyHex === 'string' && /^[0-9a-fA-F]{64}$/.test(r.keyHex),
        'must be 64 hex chars (32-byte key)');
    check(errors, 'source', GATED_KEY_SOURCES.includes(r.source),
        `must be one of ${GATED_KEY_SOURCES.join(', ')}`);
    check(errors, 'createdAt', isIsoTimestamp(r.createdAt), 'must be an ISO timestamp');
    return result(errors);
}

/**
 * Strip the secret for anything crossing out of the background
 * context (host list responses, UI rows).
 *
 * @param {GatedKey} record
 * @returns {Omit<GatedKey, 'keyHex'>}
 */
export function gatedKeyMetadata(record) {
    const { keyHex, ...meta } = record;
    return meta;
}
