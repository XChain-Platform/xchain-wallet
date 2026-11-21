// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// registerSigner (§18.3): Persist a newly-paired hardware signer.
//
// Steps 13 (Trezor) and 14 (Ledger) call this after a successful
// pairing handshake: the signer-specific code does the detection + UX
// and then hands registerSigner a bare-metal `{ vendor, model,
// deviceIdentifier, firmwareVersion }` payload. We do two things here:
//
//   1. Look up any existing signer record for the same
//      (walletId, vendor, deviceIdentifier). If one exists, update
//      `firmwareVersion` + `lastSeenAt` + optional `label` and return
//      the existing record (re-pairing the same physical device is
//      idempotent).
//
//   2. Otherwise create a fresh record via `createSignerRecord` and
//      persist it. Returns the created record so the caller can write
//      `address.signerId = record.id` on addresses derived from this
//      device.
//
// Address persistence + derivation is *not* this flow's concern;
// is a thin registry-write. Callers run `signer.getAddresses(...)`
// separately and persist `Address` records the usual way.

import { createSignerRecord, SIGNER_KINDS } from '../schemas/signer.js';
import {
    isLedgerIdentity, ledgerIdentitiesFromAccounts, withLedgerIdentities,
} from '../signers/ledgerIdentity.js';

/**
 * One SignerRecord by id. The vault's collections answer `get`; a few older
 * callers and their stand-ins name it `find`, which the vault never had, so
 * every device route that looked a record up that way threw a TypeError.
 *
 * @param {{ signers?: { get?: Function, find?: Function } } | null | undefined} vault
 * @param {string} signerId
 * @returns {Promise<any>}
 */
export async function getSignerRecord(vault, signerId) {
    const signers = vault?.signers;
    if (!signers) return null;
    if (typeof signers.get === 'function') return (await signers.get(signerId)) ?? null;
    if (typeof signers.find === 'function') return (await signers.find(signerId)) ?? null;
    return null;
}

/**
 * Record on a Ledger SignerRecord the identity of every network these
 * addresses are the first read of: a network added to an account after
 * pairing (the add-network read, or Add account with that app open). An
 * identity the record already holds is never replaced, so each network keeps
 * the key it was first read with and every later read and sign is checked
 * against it. Any other record, or nothing new, writes nothing.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} signerId
 * @param {Array<{chainId: string, accountIndex?: number, derivationPath: string, publicKey: string}>} reads
 * @returns {Promise<string[]>} the chain ids newly recorded
 */
export async function recordLedgerIdentities(vault, signerId, reads) {
    if (!vault?.signers || typeof signerId !== 'string' || !signerId) return [];
    const record = await getSignerRecord(vault, signerId);
    if (record?.vendor !== 'ledger') return [];
    const held = record.identities && typeof record.identities === 'object' ? record.identities : {};
    const fresh = ledgerIdentitiesFromAccounts(reads);
    const added = Object.keys(fresh).filter((chainId) => !isLedgerIdentity(held[chainId]));
    if (!added.length) return [];
    const identities = { ...held };
    for (const chainId of added) identities[chainId] = fresh[chainId];
    await vault.signers.put({ ...record, identities });
    return added;
}

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
 * @property {Record<string, {path: string, fingerprint: string}>} [identities]
 *           Ledger only: the per-chain identities of the keys this pairing
 *           read (signers/ledgerIdentity.js). A Ledger paired again from
 *           another coin app reports another deviceIdentifier, so these are
 *           what match it to its record; they are merged into that record.
 */

/** The well-formed entries of an identities map, or null when there are none. */
function cleanIdentities(identities) {
    if (!identities || typeof identities !== 'object') return null;
    const out = {};
    for (const [chainId, entry] of Object.entries(identities)) {
        if (chainId && isLedgerIdentity(entry)) out[chainId] = { path: entry.path, fingerprint: entry.fingerprint };
    }
    return Object.keys(out).length ? out : null;
}

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
    if (!SIGNER_KINDS.includes(kind)) {
        throw new Error(`registerSigner: kind must be one of ${SIGNER_KINDS.join(', ')}`);
    }
    if (typeof vendor !== 'string' || !vendor) {
        throw new Error('registerSigner: vendor is required');
    }
    if (vendor !== kind) {
        throw new Error('registerSigner: vendor must match kind');
    }
    if (typeof model !== 'string' || !model) {
        throw new Error('registerSigner: model is required');
    }
    if (typeof deviceIdentifier !== 'string' || !deviceIdentifier) {
        throw new Error('registerSigner: deviceIdentifier is required');
    }

    const identities = vendor === 'ledger' ? cleanIdentities(opts.identities) : null;
    const existing = await findSigner(vault, {
        walletId, vendor, deviceIdentifier, identities,
    });
    if (existing) {
        // The record keeps its id and its first identifier; a Ledger gains the
        // identities of the chains this pairing read.
        const updated = {
            ...existing,
            firmwareVersion: opts.firmwareVersion ?? existing.firmwareVersion,
            label: opts.label ?? existing.label,
            lastSeenAt: new Date().toISOString(),
            ...(identities ? { identities: { ...(existing.identities || {}), ...identities } } : {}),
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
        ...(identities ? { identities } : {}),
    });
    await vault.signers.put(record);
    return record;
}

/**
 * List signer records for a wallet. Returns an empty array when no
 * signers have been paired.
 *
 * With `withIdentities`, each Ledger record also carries an identity for
 * every chain it has a stored address on (signers/ledgerIdentity.js), so a
 * record paired before identities were stored, or a chain added after
 * pairing, can still be checked from that chain's app on reconnect. That
 * costs one bulk address read, made only when the wallet has a Ledger.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} walletId
 * @param {{ withIdentities?: boolean }} [opts]
 * @returns {Promise<import('../schemas/signer.js').SignerRecord[]>}
 */
export async function listSignersForWallet(vault, walletId, { withIdentities = false } = {}) {
    if (!vault) throw new Error('listSignersForWallet: vault is required');
    if (typeof walletId !== 'string' || !walletId) {
        throw new Error('listSignersForWallet: walletId is required');
    }
    const all = await vault.signers.list();
    const own = all.filter((r) => r.walletId === walletId);
    if (!withIdentities || !vault.addresses || !own.some((r) => r.vendor === 'ledger')) return own;
    const addresses = await vault.addresses.list();
    return own.map((r) => withLedgerIdentities(r, addresses));
}

/** A signer that stored addresses still name cannot be removed. */
export class SignerInUseError extends Error {
    /**
     * @param {string} signerId
     * @param {string[]} addressIds
     */
    constructor(signerId, addressIds) {
        super(
            `unregisterSigner: signer "${signerId}" is still used by ${addressIds.length} address(es); `
            + 'remove those addresses, or the wallet, first',
        );
        this.name = 'SignerInUseError';
        this.code = 'SIGNER_IN_USE';
        this.signerId = signerId;
        this.addressIds = addressIds;
    }
}

/**
 * Remove a paired signer that no stored address names. A re-pair mints a new
 * record id and nothing rewrites an address's signerId, so deleting a signer
 * an address still names would leave that address unsignable; such a call is
 * refused with SignerInUseError. A device wallet goes together with its
 * addresses through removeWallet. Returns true if a record was deleted,
 * false if it wasn't found.
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
    if (typeof vault.addresses?.list !== 'function') {
        throw new Error('unregisterSigner: the vault has no address store to check');
    }
    const inUse = (await vault.addresses.list()).filter((a) => a?.signerId === signerId).map((a) => a.id);
    if (inUse.length > 0) throw new SignerInUseError(signerId, inUse);
    return vault.signers.delete(signerId);
}

/**
 * Find an existing signer record by (walletId, vendor, deviceIdentifier).
 * Used by registerSigner for re-pair idempotence.
 *
 * A Ledger's identifier depends on the coin app open at pairing, so the
 * same Ledger paired again from another app (Litecoin, say) reports another
 * one. With `identities`, a Ledger record of the wallet also matches when any
 * of its identities (stored, or derived from the addresses it gave; see
 * signers/ledgerIdentity.js) hashes the same key. The addresses are read only
 * when no identifier matched and the wallet has a Ledger record.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {{ walletId: string, vendor: string, deviceIdentifier: string,
 *   identities?: Record<string, {path: string, fingerprint: string}> | null }} query
 * @returns {Promise<import('../schemas/signer.js').SignerRecord | null>}
 */
export async function findSigner(vault, { walletId, vendor, deviceIdentifier, identities }) {
    const all = await vault.signers.list();
    const own = all.filter((r) => r.walletId === walletId && r.vendor === vendor);
    const exact = own.find((r) => r.deviceIdentifier === deviceIdentifier);
    if (exact) return exact;
    const wanted = new Set(Object.values(cleanIdentities(identities) || {}).map((entry) => entry.fingerprint));
    if (vendor !== 'ledger' || wanted.size === 0 || own.length === 0) return null;
    const addresses = vault.addresses ? await vault.addresses.list() : [];
    return own.find((r) => Object.values(withLedgerIdentities(r, addresses).identities || {})
        .some((entry) => wanted.has(entry?.fingerprint))) || null;
}
