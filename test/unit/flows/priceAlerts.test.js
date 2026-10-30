// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: flows/priceAlerts: CRUD round-trip against a real in-memory Vault.

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

    it('does not collapse alerts denominated in different currencies', async () => {
        const usd = await saveAlert({ vault, ...ALERT });
        const eur = await saveAlert({ vault, ...ALERT, fiatCurrency: 'EUR' });

        expect(eur.id).not.toBe(usd.id);
        expect(eur.fiatCurrency).toBe('eur');
        expect(await vault.priceAlerts.count()).toBe(2);
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

    it('edits an alert in place and re-arms it', async () => {
        const original = await saveAlert({ vault, ...ALERT });
        await markAlertTriggered({ vault, id: original.id });

        const edited = await saveAlert({
            vault,
            ...ALERT,
            id: original.id,
            direction: 'below',
            targetFiat: 64000,
            fiatCurrency: 'eur',
        });

        expect(edited).toMatchObject({
            id: original.id,
            direction: 'below',
            targetFiat: 64000,
            fiatCurrency: 'eur',
            status: 'armed',
            triggeredAt: null,
        });
        expect(await vault.priceAlerts.count()).toBe(1);
    });

    it('rejects an edit that would duplicate another alert', async () => {
        const first = await saveAlert({ vault, ...ALERT });
        await saveAlert({ vault, ...ALERT, direction: 'below' });

        await expect(saveAlert({
            vault,
            ...ALERT,
            id: first.id,
            direction: 'below',
        })).rejects.toThrow('A matching price alert already exists');
        expect(await vault.priceAlerts.count()).toBe(2);
    });

    it('does not edit an alert through another wallet', async () => {
        const original = await saveAlert({ vault, ...ALERT });

        await expect(saveAlert({
            vault,
            ...ALERT,
            id: original.id,
            walletId: 'wallet-2',
            targetFiat: 1,
        })).rejects.toThrow('alert was not found for this wallet');
        expect((await vault.priceAlerts.get(original.id)).targetFiat).toBe(70000);
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

    it('does not restore an alert when deletion races its triggered transition', async () => {
        const alert = await saveAlert({ vault, ...ALERT });
        const originalGet = vault.priceAlerts.get.bind(vault.priceAlerts);
        let releaseRead;
        let markRead;
        const readStarted = new Promise((resolve) => { markRead = resolve; });
        const readReleased = new Promise((resolve) => { releaseRead = resolve; });
        let firstRead = true;
        vault.priceAlerts.get = async (id) => {
            const record = await originalGet(id);
            if (firstRead) {
                firstRead = false;
                markRead();
                await readReleased;
            }
            return record;
        };

        const marking = markAlertTriggered({ vault, id: alert.id });
        await readStarted;
        const clearing = clearAlert({ vault, id: alert.id });
        releaseRead();

        await expect(marking).resolves.toMatchObject({ status: 'triggered' });
        await expect(clearing).resolves.toBe(true);
        expect(await originalGet(alert.id)).toBeNull();
    });

    it('keeps a triggered alert disarmed after reopening the vault', async () => {
        const backend = new InMemoryBackend();
        const firstVault = new Vault({ backend, masterKey: MASTER_KEY });
        await firstVault.open();
        const alert = await saveAlert({ vault: firstVault, ...ALERT });
        await markAlertTriggered({ vault: firstVault, id: alert.id });
        firstVault.close();

        const reopenedVault = new Vault({ backend, masterKey: MASTER_KEY });
        await reopenedVault.open();

        expect(await listAlertsForWallet({ vault: reopenedVault, walletId: ALERT.walletId }))
            .toMatchObject([{ id: alert.id, status: 'triggered' }]);
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

    it('leaves an alert edited since it fired armed when markAlertTriggered carries the fired terms', async () => {
        const saved = await saveAlert({ vault, ...ALERT });
        const firedTerms = 'bitcoin-mainnet::above::70000::usd';
        await saveAlert({ vault, ...ALERT, id: saved.id, targetFiat: 90000 });
        expect(await markAlertTriggered({ vault, id: saved.id, terms: firedTerms })).toBeNull();
        const [row] = await listAlertsForWallet({ vault, walletId: 'wallet-1' });
        expect(row.status).toBe('armed');
        expect(row.targetFiat).toBe(90000);
        const marked = await markAlertTriggered({ vault, id: saved.id, terms: 'bitcoin-mainnet::above::90000::usd' });
        expect(marked.status).toBe('triggered');
    });
});
