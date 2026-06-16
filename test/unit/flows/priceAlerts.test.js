// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: flows/priceAlerts — CRUD round-trip against a real in-memory Vault.

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    listAlertsForWallet,
    saveAlert,
    clearAlert,
    markAlertTriggered,
    rearmAlert,
} from '../../../packages/core/src/flows/priceAlerts.js';

const MASTER_KEY = new Uint8Array(32).fill(7);
const ALERT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    direction: 'above',
    targetFiat: 70000,
    fiatCurrency: 'usd',
};

/** @type {Vault} */
let vault;
beforeEach(async () => {
    vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
    await vault.open();
});

describe('flows/priceAlerts', () => {
    it('saves and lists an alert for a wallet', async () => {
        const saved = await saveAlert({ vault, ...ALERT });
        expect(saved.status).toBe('armed');
        const list = await listAlertsForWallet({ vault, walletId: 'wallet-1' });
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(saved.id);
    });

    it('is idempotent on an identical armed alert (no duplicate)', async () => {
        const a = await saveAlert({ vault, ...ALERT });
        const b = await saveAlert({ vault, ...ALERT });
        expect(b.id).toBe(a.id);
        expect(await vault.priceAlerts.count()).toBe(1);
    });

    it('does not collide across direction/target', async () => {
        await saveAlert({ vault, ...ALERT });
        await saveAlert({ vault, ...ALERT, direction: 'below' });
        await saveAlert({ vault, ...ALERT, targetFiat: 80000 });
        expect(await vault.priceAlerts.count()).toBe(3);
    });

    it('re-arms a triggered alert when the same alert is re-saved', async () => {
        const a = await saveAlert({ vault, ...ALERT });
        await markAlertTriggered({ vault, id: a.id });
        expect((await vault.priceAlerts.get(a.id)).status).toBe('triggered');
        const again = await saveAlert({ vault, ...ALERT });
        expect(again.id).toBe(a.id);
        expect(again.status).toBe('armed');
        expect(again.triggeredAt).toBeNull();
        expect(await vault.priceAlerts.count()).toBe(1);
    });

    it('markAlertTriggered disarms with a timestamp', async () => {
        const a = await saveAlert({ vault, ...ALERT });
        const t = await markAlertTriggered({ vault, id: a.id, at: '2026-06-15T00:00:00.000Z' });
        expect(t.status).toBe('triggered');
        expect(t.triggeredAt).toBe('2026-06-15T00:00:00.000Z');
    });

    it('rearmAlert resets a triggered alert', async () => {
        const a = await saveAlert({ vault, ...ALERT });
        await markAlertTriggered({ vault, id: a.id });
        const r = await rearmAlert({ vault, id: a.id });
        expect(r.status).toBe('armed');
        expect(r.triggeredAt).toBeNull();
    });

    it('clearAlert removes the alert', async () => {
        const a = await saveAlert({ vault, ...ALERT });
        expect(await clearAlert({ vault, id: a.id })).toBe(true);
        expect(await listAlertsForWallet({ vault, walletId: 'wallet-1' })).toHaveLength(0);
    });

    it('markAlertTriggered / rearmAlert no-op on a missing id', async () => {
        expect(await markAlertTriggered({ vault, id: 'nope' })).toBeNull();
        expect(await rearmAlert({ vault, id: 'nope' })).toBeNull();
    });

    it('rejects invalid inputs', async () => {
        await expect(saveAlert({ vault, ...ALERT, direction: 'x' })).rejects.toThrow();
        await expect(saveAlert({ vault, ...ALERT, targetFiat: 0 })).rejects.toThrow();
        await expect(saveAlert({ vault, ...ALERT, walletId: '' })).rejects.toThrow();
    });
});
