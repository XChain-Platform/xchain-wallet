// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Price-alert CRUD flows — §46. Thin wrappers around the vault's
// priceAlerts collection, mirroring the watchlist flow shape. The
// NotificationsSection manager + the TokenDetail "Set price alert" entry
// read via listAlertsForWallet and write via saveAlert / clearAlert; the
// background PriceAlertWatcher disarms a fired alert via markAlertTriggered
// and the manager re-arms via rearmAlert.

import {
    createPriceAlert as buildAlert,
    priceAlertKey,
} from '../schemas/priceAlert.js';

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string }} params
 */
export async function listAlertsForWallet({ vault, walletId }) {
    if (!vault) throw new Error('listAlertsForWallet: vault is required');
    if (!walletId) throw new Error('listAlertsForWallet: walletId is required');
    return vault.priceAlerts.findBy('walletId', walletId);
}

/**
 * Add a price alert. Idempotent by (walletId, chainId, direction,
 * targetFiat): an existing match is returned as-is when armed, or re-armed
 * (status → 'armed', triggeredAt → null) when it had already fired — so
 * re-adding the same alert "resets" it rather than stacking duplicates.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string, chainId: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }} params
 */
export async function saveAlert({ vault, walletId, chainId, direction, targetFiat, fiatCurrency }) {
    if (!vault) throw new Error('saveAlert: vault is required');
    if (!walletId) throw new Error('saveAlert: walletId is required');
    if (!chainId) throw new Error('saveAlert: chainId is required');
    if (direction !== 'above' && direction !== 'below') {
        throw new Error('saveAlert: direction must be "above" or "below"');
    }
    if (typeof targetFiat !== 'number' || !Number.isFinite(targetFiat) || targetFiat <= 0) {
        throw new Error('saveAlert: targetFiat must be a positive number');
    }
    const record = buildAlert({ walletId, chainId, direction, targetFiat, fiatCurrency });
    const existing = await vault.priceAlerts.findBy('walletId', walletId);
    const match = (existing || []).find((e) => priceAlertKey(e) === priceAlertKey(record));
    if (match) {
        if (match.status === 'triggered') {
            const rearmed = { ...match, status: 'armed', triggeredAt: null };
            await vault.priceAlerts.put(rearmed);
            return rearmed;
        }
        return match;
    }
    await vault.priceAlerts.put(record);
    return record;
}

/**
 * Remove an alert by id.
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string }} params
 */
export async function clearAlert({ vault, id }) {
    if (!vault) throw new Error('clearAlert: vault is required');
    if (!id) throw new Error('clearAlert: id is required');
    return vault.priceAlerts.delete(id);
}

/**
 * Disarm an alert after it fires (one-shot). Records when it triggered.
 * Called by the PriceAlertWatcher; a no-op if the id no longer exists.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string, at?: string }} params
 */
export async function markAlertTriggered({ vault, id, at }) {
    if (!vault) throw new Error('markAlertTriggered: vault is required');
    if (!id) throw new Error('markAlertTriggered: id is required');
    const alert = await vault.priceAlerts.get(id);
    if (!alert) return null;
    const updated = { ...alert, status: 'triggered', triggeredAt: at || new Date().toISOString() };
    await vault.priceAlerts.put(updated);
    return updated;
}

/**
 * Re-arm a previously-triggered alert so the watcher fires it again.
 * @param {{ vault: import('../storage/Vault.js').Vault, id: string }} params
 */
export async function rearmAlert({ vault, id }) {
    if (!vault) throw new Error('rearmAlert: vault is required');
    if (!id) throw new Error('rearmAlert: id is required');
    const alert = await vault.priceAlerts.get(id);
    if (!alert) return null;
    const updated = { ...alert, status: 'armed', triggeredAt: null };
    await vault.priceAlerts.put(updated);
    return updated;
}
