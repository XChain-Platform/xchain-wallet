// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the wallet-wide automatic donation queue through the live vault paths
// (§36, ruling 2026-11-14). Every broadcast on any chain accrues the same fiat
// amount into one queue; a carried donation takes its amount off only when it
// is booked after the broadcast; the settings patch the page writes merges
// and validates; the vault stores the record sparse; and a stored v3 record
// with per-chain sats queues reads back as the v4 fiat setting.

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { commitAdsStep, stepAdsQueue, isAdsDue } from '../../../packages/core/src/flows/ads.js';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { CURRENT_VERSION, createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';

const chainRegistry = defaultRegistry();

const seeded = () => seedSettingsForChains(
    createDefaultSettings(),
    chainRegistry,
    ['bitcoin-mainnet', 'dogecoin-mainnet'],
);

async function makeVault() {
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey });
    await vault.open();
    return vault;
}

describe('one queue across every chain', () => {
    it('accrues the same fiat amount for a send on any chain, broadcast by broadcast', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());
        // A BTC send, a DOGE send and an LTC testnet send each add $0.05.
        for (let i = 0; i < 3; i += 1) await commitAdsStep({ vault });
        const s = await vault.settings.get();
        expect(s.ads.queued).toBe('0.15');
        expect(s.ads.donationCount).toBe(0);
    });

    it('becomes due on the send that reaches the send-at total, not the one before', () => {
        let s = createDefaultSettings();
        s = { ...s, ads: { ...s.ads, perTransaction: '1', sendAt: '25' } };
        for (let i = 0; i < 24; i += 1) s = stepAdsQueue(s);
        expect(isAdsDue(s)).toBe(false);
        s = stepAdsQueue(s);
        expect(s.ads.queued).toBe('25');
        expect(isAdsDue(s)).toBe(true);
    });

    it('a carried donation leaves the queue only when it is booked after the broadcast', async () => {
        const vault = await makeVault();
        const base = seeded();
        await vault.settings.put({ ...base, ads: { ...base.ads, queued: '25.05' } });
        await commitAdsStep({ vault, donationIncluded: true, donatedFiat: '25.05', currency: 'USD' });
        const s = await vault.settings.get();
        expect(s.ads).toMatchObject({ queued: '0.05', donated: '25.05', donationCount: 1 });
    });

    it('never subtracts a donation booked in another currency, and never goes below zero', () => {
        const base = createDefaultSettings();
        const s = { ...base, ads: { ...base.ads, queued: '10', donated: '1' } };
        expect(stepAdsQueue(s, { donationIncluded: true, donatedFiat: '10', currency: 'EUR' }).ads)
            .toMatchObject({ queued: '10.05', donated: '1', donationCount: 0 });
        expect(stepAdsQueue(s, { donationIncluded: true, donatedFiat: '12', currency: 'USD' }).ads)
            .toMatchObject({ queued: '0.05', donated: '13', donationCount: 1 });
    });

    it('adds nothing while donations are off, and writes nothing', async () => {
        const vault = await makeVault();
        const base = seeded();
        await vault.settings.put({ ...base, ads: { ...base.ads, perTransaction: '0', queued: '3' } });
        const before = await vault.settings.get();
        const after = stepAdsQueue(before);
        expect(after).toBe(before);
    });

    it('follows the display currency only while nothing is queued or donated', () => {
        const base = { ...createDefaultSettings(), fiatCurrency: 'EUR' };
        expect(stepAdsQueue(base).ads.currency).toBe('EUR');
        const held = { ...base, ads: { ...base.ads, queued: '1' } };
        expect(stepAdsQueue(held).ads.currency).toBe('USD');
    });
});

describe('the page patch', () => {
    it('merges one donation field and keeps the queue', async () => {
        const vault = await makeVault();
        const base = seeded();
        await vault.settings.put({ ...base, ads: { ...base.ads, queued: '3.45' } });
        const s = await updateSettings(vault, { ads: { sendAt: '50', currency: 'USD' } });
        expect(s.ads).toMatchObject({ sendAt: '50', queued: '3.45', perTransaction: '0.05' });
    });

    it('refuses an amount outside the bounds', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());
        await expect(updateSettings(vault, { ads: { perTransaction: '11' } })).rejects.toThrow(/ads/);
        await expect(updateSettings(vault, { ads: { sendAt: '0.5' } })).rejects.toThrow(/ads/);
        await expect(updateSettings(vault, { ads: { perTransaction: '0.055' } })).rejects.toThrow(/ads/);
        await expect(updateSettings(vault, { ads: { recipient: 'someone' } })).rejects.toThrow(/ads/);
    });

    it('fee preferences still store null for a value equal to the release default', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());
        const s = await updateSettings(vault, {
            fees: { 'bitcoin-mainnet': { strategy: 'normal', rbfByDefault: false } },
        });
        expect(s.fees['bitcoin-mainnet'].strategy).toBe(null);
        expect(s.fees['bitcoin-mainnet'].rbfByDefault).toBe(false);
    });
});

describe('the vault stores settings sparse (§35.10)', () => {
    it('a pristine default record persists as schemaVersion only', async () => {
        const vault = await makeVault();
        await vault.settings.put(createDefaultSettings());
        expect(vault._doc.settings).toEqual({ schemaVersion: CURRENT_VERSION });
        expect(await vault.settings.get()).toEqual(createDefaultSettings());
    });

    it('stores only the donation fields that differ from the defaults', async () => {
        const vault = await makeVault();
        const base = createDefaultSettings();
        await vault.settings.put({ ...base, ads: { ...base.ads, queued: '1.5', recipient: 'explorer' } });
        expect(vault._doc.settings.ads).toEqual({ queued: '1.5', recipient: 'explorer' });
        expect((await vault.settings.get()).ads).toMatchObject({ queued: '1.5', recipient: 'explorer', sendAt: '5' });
    });

    it('per-chain fee entries survive deflation so the active-chain set is preserved', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());
        expect(Object.keys(vault._doc.settings.fees).sort())
            .toEqual(['bitcoin-mainnet', 'dogecoin-mainnet']);
        expect(vault._doc.settings.ads).toBeUndefined();
    });
});

describe('a stored v3 record migrates on read', () => {
    it('reads per-chain settings back as the wallet-wide fiat setting', async () => {
        const vault = await makeVault();
        // The sparse v3 form: the switch left at its default (absent = on), a
        // DOGE recipient choice, and test-network queues worth nothing.
        vault._doc.settings = {
            schemaVersion: 3,
            ads: {
                perChain: {
                    'dogecoin-testnet': { accumulatedSats: 90000000, lifetimeDonatedSats: 0, lifetimeTxCount: 4, donationAddressRole: 'EXPLORER' },
                    'bitcoin-regtest': { accumulatedSats: 5000, lifetimeDonatedSats: 0, lifetimeTxCount: 1 },
                },
            },
        };
        const s = await vault.settings.get();
        expect(s.schemaVersion).toBe(CURRENT_VERSION);
        expect(s.ads).toEqual({
            perTransaction: '0.05',
            sendAt: '5',
            recipient: 'explorer',
            currency: 'USD',
            queued: '0',
            donated: '0',
            donationCount: 0,
        });
    });
});
