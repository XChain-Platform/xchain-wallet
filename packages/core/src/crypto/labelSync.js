// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Label-sync commitment key + payload codec (§19.5.2).
//
// Deterministic, seed-derived encryption that lets labels + contacts
// survive a from-seed restore WITHOUT an external backup file. The
// ciphertext is published via a FILE action on-chain; on restore the
// wallet re-derives the commitment key from the seed, queries the
// chain's FILE actions for the matching discovery name, and decrypts.
//
// Privacy property (from the spec):
//   Publishing labels on-chain exposes THAT the user has published
//   labels, but not what those labels are (encrypted). The commitment
//   key is deterministic from the seed, so an adversary who knows the
//   seed can find the labels. If they know the seed, they already
//   have the funds. Labels are no worse off.

import { sha256 } from '@noble/hashes/sha2';
import { decrypt as aeadDecrypt, encrypt as aeadEncrypt } from './aead.js';

export const LABEL_SYNC_DOMAIN = 'xchain-wallet-label-sync';

/**
 * SHA256("xchain-wallet-label-sync" || seed). Deterministic; the same
 * seed always produces the same key. 32 bytes, directly usable as an
 * AES-256 key, no stretching needed (seed already has full entropy).
 *
 * @param {Uint8Array} seed          64 bytes for BIP39, 16 bytes for Counterwallet
 * @returns {Uint8Array}             32 bytes
 */
export function computeLabelSyncCommitmentKey(seed) {
    if (!(seed instanceof Uint8Array) || seed.length === 0) {
        throw new Error('computeLabelSyncCommitmentKey: seed must be a non-empty Uint8Array');
    }
    const domain = new TextEncoder().encode(LABEL_SYNC_DOMAIN);
    const buf = new Uint8Array(domain.length + seed.length);
    buf.set(domain, 0);
    buf.set(seed, domain.length);
    try {
        return sha256(buf);
    } finally {
        buf.fill(0);
    }
}

/**
 * SHA256 of the commitment key, hex-encoded. Used as the FILE action's
 * `name` field so a restoring wallet can discover the ciphertext
 * without trying to decrypt every FILE on the chain.
 *
 * @param {Uint8Array} commitmentKey
 * @returns {string}                 64-char lowercase hex
 */
export function computeLabelSyncDiscoveryName(commitmentKey) {
    if (!(commitmentKey instanceof Uint8Array) || commitmentKey.length !== 32) {
        throw new Error('computeLabelSyncDiscoveryName: commitmentKey must be a 32-byte Uint8Array');
    }
    const hash = sha256(commitmentKey);
    let out = '';
    for (const b of hash) out += b.toString(16).padStart(2, '0');
    return out;
}

/**
 * @typedef {Object} LabelSyncBody
 * @property {1} version
 * @property {string} updatedAt          ISO timestamp
 * @property {Array<{ id: string, address: string, label: string }>} labels
 * @property {Array<{ id: string, name: string, notes: string, entries: Array<{ chain: string, address: string, label: string }> }>} contacts
 */

/**
 * Encrypt a LabelSyncBody into the ciphertext that lands in the FILE
 * action's content. Output layout is the AEAD module's packed
 * `iv || ct || tag` blob. The FILE action carries opaque bytes, so
 * there's no reason to split iv/tag into separate fields the way the
 * §19.4 envelope does.
 *
 * @param {Uint8Array} commitmentKey
 * @param {LabelSyncBody} body
 * @returns {Promise<Uint8Array>}
 */
export async function encodeLabelSyncPayload(commitmentKey, body) {
    assertKey(commitmentKey);
    const json = JSON.stringify(body);
    const plaintext = new TextEncoder().encode(json);
    try {
        return await aeadEncrypt(commitmentKey, plaintext);
    } finally {
        plaintext.fill(0);
    }
}

/**
 * Decrypt a ciphertext produced by `encodeLabelSyncPayload`.
 *
 * @param {Uint8Array} commitmentKey
 * @param {Uint8Array} ciphertext
 * @returns {Promise<LabelSyncBody>}
 */
export async function decodeLabelSyncPayload(commitmentKey, ciphertext) {
    assertKey(commitmentKey);
    const plaintext = await aeadDecrypt(commitmentKey, ciphertext);
    try {
        const parsed = JSON.parse(new TextDecoder().decode(plaintext));
        if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
            throw new Error('decodeLabelSyncPayload: unsupported payload version');
        }
        return parsed;
    } finally {
        plaintext.fill(0);
    }
}

function assertKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
        throw new Error('labelSync: commitmentKey must be a 32-byte Uint8Array');
    }
}
