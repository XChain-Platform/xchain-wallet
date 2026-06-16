// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CRUD flows for the §40.9 pending-airdrop collection. Thin wrappers
// around the vault's typed collection handle so the renderer can reach
// them through the messaging host without plumbing the vault across
// the IPC boundary.
//
// AirdropForm writes at stage 3 (save), polls + patches at stage 4
// (update → listActionIndex + stage transition), patches again at
// stage 6 (update → airdropTxid + stage='done'), and the Home
// resume-card clears 'done' records on click.

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, record: import('../schemas/pendingAirdrop.js').PendingAirdrop }} params
 */
export async function savePendingAirdrop({ vault, record }) {
    if (!vault) throw new Error('savePendingAirdrop: vault is required');
    if (!record) throw new Error('savePendingAirdrop: record is required');
    await vault.pendingAirdrops.put(record);
    return record;
}

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string }} params
 */
export async function listPendingAirdropsForWallet({ vault, walletId }) {
    if (!vault) throw new Error('listPendingAirdropsForWallet: vault is required');
    if (!walletId) throw new Error('listPendingAirdropsForWallet: walletId is required');
    return vault.pendingAirdrops.findBy('walletId', walletId);
}

/**
 * Merge a patch into an existing pending-airdrop record. Re-reads the
 * current record before writing so concurrent stage transitions don't
 * clobber each other (the form itself is single-tab but defensive is
 * cheap here).
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string, patch: Partial<import('../schemas/pendingAirdrop.js').PendingAirdrop> }} params
 */
export async function updatePendingAirdrop({ vault, id, patch }) {
    if (!vault) throw new Error('updatePendingAirdrop: vault is required');
    if (!id) throw new Error('updatePendingAirdrop: id is required');
    if (!patch || typeof patch !== 'object') {
        throw new Error('updatePendingAirdrop: patch is required');
    }
    const current = await vault.pendingAirdrops.get(id);
    if (!current) throw new Error(`updatePendingAirdrop: no record for id "${id}"`);
    const next = { ...current, ...patch, id: current.id, schemaVersion: current.schemaVersion };
    await vault.pendingAirdrops.put(next);
    return next;
}

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string }} params
 */
export async function clearPendingAirdrop({ vault, id }) {
    if (!vault) throw new Error('clearPendingAirdrop: vault is required');
    if (!id) throw new Error('clearPendingAirdrop: id is required');
    return vault.pendingAirdrops.delete(id);
}
