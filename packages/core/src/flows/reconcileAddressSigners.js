// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// reconcileAddressSigners — closes the Address v1→v2 migration loop
// (§17.6). Walks every persisted address with `signerId === null`
// (produced by the schemaVersion migration) and attempts to match it
// to one of the supplied signers by deriving the pubkey at the
// address's stored derivationPath — a match means that signer owns
// the address, so we write its id back.
//
// Signers must be unlocked. The caller holds the unlock(s); we don't
// touch lock/unlock state. A typical use is `withUnlocked(..., async
// (signer) => reconcileAddressSigners({ ..., signers: [signer] }))`.
//
// The function is idempotent: addresses already linked to a signer are
// not touched. Addresses with `derivationPath === null` (imported-WIF,
// watch-only) and addresses whose (coin, network) doesn't match a
// registered chain are recorded as skipped with a reason.
//
// Ambiguity (multiple signers derive the same pubkey at the same path)
// is treated as an error — it shouldn't happen in practice (distinct
// seeds produce distinct child keys) and silently picking one signer
// could misroute future operations.

export class AmbiguousSignerMatchError extends Error {
    constructor(addressId, signerIds) {
        super(
            `reconcileAddressSigners: address "${addressId}" matches multiple signers: ${signerIds.join(', ')}`,
        );
        this.name = 'AmbiguousSignerMatchError';
        this.addressId = addressId;
        this.signerIds = signerIds;
    }
}

/**
 * @typedef {Object} ReconcileSkip
 * @property {string} id
 * @property {'no-path' | 'unknown-chain' | 'no-match'} reason
 */

/**
 * @typedef {Object} ReconcileResult
 * @property {number} scanned            addresses inspected (signerId === null and matching any filter)
 * @property {number} reconciled         successfully matched and updated
 * @property {ReconcileSkip[]} skipped   per-address skip reasons
 */

/**
 * @typedef {Object} ReconcileOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../signers/Signer.js').Signer[]} signers     must be unlocked
 * @property {string} [walletId]                                    filter: only reconcile this wallet's addresses
 * @property {string} [chainId]                                     filter: only reconcile addresses on this chain
 */

/**
 * @param {ReconcileOpts} opts
 * @returns {Promise<ReconcileResult>}
 */
export async function reconcileAddressSigners({
    vault,
    chainRegistry,
    signers,
    walletId,
    chainId,
}) {
    if (!vault) throw new Error('reconcileAddressSigners: vault is required');
    if (!chainRegistry) throw new Error('reconcileAddressSigners: chainRegistry is required');
    if (!Array.isArray(signers) || signers.length === 0) {
        throw new Error('reconcileAddressSigners: signers must be a non-empty array');
    }

    // Optional wallet filter: resolve accountIds owned by the wallet.
    /** @type {Set<string> | null} */
    let accountIdFilter = null;
    if (walletId !== undefined) {
        const accts = await vault.accounts.findBy('walletId', walletId);
        accountIdFilter = new Set(accts.map((a) => a.id));
    }

    const addresses = await vault.addresses.list();

    /** @type {ReconcileSkip[]} */
    const skipped = [];
    let scanned = 0;
    let reconciled = 0;

    for (const addr of addresses) {
        if (addr.signerId !== null) continue;
        if (accountIdFilter && (!addr.accountId || !accountIdFilter.has(addr.accountId))) continue;

        const cid = chainRegistry.chainIdFor(addr.chain, addr.network);
        if (chainId && cid !== chainId) continue;
        scanned++;

        if (addr.derivationPath === null || typeof addr.derivationPath !== 'string') {
            skipped.push({ id: addr.id, reason: 'no-path' });
            continue;
        }
        if (!cid) {
            skipped.push({ id: addr.id, reason: 'unknown-chain' });
            continue;
        }

        const matches = [];
        for (const signer of signers) {
            let derived;
            try {
                derived = await signer.getPublicKey({
                    chainId: cid,
                    path: addr.derivationPath,
                });
            } catch {
                // Signer can't derive at this path (e.g. locked, wrong chain
                // support). Not a match; try the next.
                continue;
            }
            if (derived.publicKey && derived.publicKey === addr.publicKey) {
                matches.push(signer.id);
            }
        }

        if (matches.length === 0) {
            skipped.push({ id: addr.id, reason: 'no-match' });
            continue;
        }
        if (matches.length > 1) {
            throw new AmbiguousSignerMatchError(addr.id, matches);
        }

        await vault.addresses.put({ ...addr, signerId: matches[0] });
        reconciled++;
    }

    return { scanned, reconciled, skipped };
}
