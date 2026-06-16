// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// registerSigner — §18.3. Persist a newly-paired hardware signer.
//
// Steps 13 (Trezor) and 14 (Ledger) call this after a successful
// pairing handshake: the signer-specific code does the detection + UX
// and then hands registerSigner a bare-metal `{ vendor, model,
// deviceIdentifier, firmwareVersion }` payload. We do two things here:
//
//   1. Look up any existing signer record for the same
//      (walletId, vendor, deviceIdentifier). If one exists, update
//      `firmwareVersion` + `lastSeenAt` + optional `label` and return
//      the existing record — re-pairing the same physical device is
//      idempotent.
//
//   2. Otherwise create a fresh record via `createSignerRecord` and
//      persist it. Returns the created record so the caller can write
//      `address.signerId = record.id` on addresses derived from this
//      device.
//
// Address persistence + derivation is *not* this flow's concern — it
// is a thin registry-write. Callers run `signer.getAddresses(...)`
// separately and persist `Address` records the usual way.

import { createSignerRecord } from '../schemas/signer.js';

/**
 * @typedef {Object} RegisterSignerOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {import('../schemas/signer.js').SignerKind} kind
 * @property {string} vendor
 * @property {string} model
 * @property {string} deviceIdentifier
 * @property {string} [label]                      optional user-chosen label
 * @property {string | null} [firmwareVersion]
 */

/**
 * @param {RegisterSignerOpts} opts
 * @returns {Promise<import('../schemas/signer.js').SignerRecord>}
 */
export async function registerSigner(opts) {
    if (!opts) throw new Error('registerSigner: opts is required');
    const { vault, walletId, kind, vendor, model, deviceIdentifier } = opts;
    if (!vault) throw new Error('registerSigner: vault is required');
    if (typeof walletId !== 'string' || !walletId) {
        throw new Error('registerSigner: walletId is required');
    }
    if (typeof kind !== 'string' || !kind) {
        throw new Error('registerSigner: kind is required');
    }
    if (typeof vendor !== 'string' || !vendor) {
        throw new Error('registerSigner: vendor is required');
    }
    if (typeof model !== 'string' || !model) {
        throw new Error('registerSigner: model is required');
    }
    if (typeof deviceIdentifier !== 'string' || !deviceIdentifier) {
        throw new Error('registerSigner: deviceIdentifier is required');
    }

    const existing = await findSigner(vault, {
        walletId, vendor, deviceIdentifier,
    });
    if (existing) {
        const updated = {
            ...existing,
            firmwareVersion: opts.firmwareVersion ?? existing.firmwareVersion,
            label: opts.label ?? existing.label,
            lastSeenAt: new Date().toISOString(),
        };
        await vault.signers.put(updated);
        return updated;
    }
    const record = createSignerRecord({
        walletId,
        kind,
        vendor,
        model,
        deviceIdentifier,
        label: opts.label,
        firmwareVersion: opts.firmwareVersion ?? null,
    });
    await vault.signers.put(record);
    return record;
}

/**
 * List signer records for a wallet. Returns an empty array when no
 * signers have been paired.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} walletId
 * @returns {Promise<import('../schemas/signer.js').SignerRecord[]>}
 */
export async function listSignersForWallet(vault, walletId) {
    if (!vault) throw new Error('listSignersForWallet: vault is required');
    if (typeof walletId !== 'string' || !walletId) {
        throw new Error('listSignersForWallet: walletId is required');
    }
    const all = await vault.signers.list();
    return all.filter((r) => r.walletId === walletId);
}

/**
 * Remove a paired signer. Does NOT cascade — addresses still point
 * at the old signerId until a subsequent reconciliation pass
 * rewrites them (or the user manually replaces them). Returns true
 * if a record was deleted, false if it wasn't found.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} signerId
 * @returns {Promise<boolean>}
 */
export async function unregisterSigner(vault, signerId) {
    if (!vault) throw new Error('unregisterSigner: vault is required');
    if (typeof signerId !== 'string' || !signerId) {
        throw new Error('unregisterSigner: signerId is required');
    }
    return vault.signers.delete(signerId);
}

/**
 * Find an existing signer record by (walletId, vendor, deviceIdentifier).
 * Used by registerSigner for re-pair idempotence.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {{ walletId: string, vendor: string, deviceIdentifier: string }} query
 * @returns {Promise<import('../schemas/signer.js').SignerRecord | null>}
 */
export async function findSigner(vault, { walletId, vendor, deviceIdentifier }) {
    const all = await vault.signers.list();
    return all.find((r) =>
        r.walletId === walletId
        && r.vendor === vendor
        && r.deviceIdentifier === deviceIdentifier,
    ) || null;
}
