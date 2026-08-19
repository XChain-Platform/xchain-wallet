// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §36.6 release-tunable ADS defaults through the live paths. The
// accumulator advances by the RESOLVED per-coin amount (stored null =
// follow the descriptor), the trigger fires against the resolved
// threshold, updateSettings rewrites a value equal to the descriptor
// default back to null (the FreeWallet rule), and the vault stores the
// settings record sparse so a pristine wallet persists nothing but its
// schema version.

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
    resolveAdsForNextTx,
    stepAdsAccumulator,
} from '../../../packages/core/src/flows/ads.js';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';
import { seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
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

describe('stepAdsAccumulator resolves the per-tx amount per coin (§36.6)', () => {
    it('DOGE accrues 0.05 DOGE per tx from a null (follow-default) field', () => {
        const next = stepAdsAccumulator(seeded(), 'dogecoin-mainnet', {
            donationIncluded: false,
            chainRegistry,
        });
        expect(next.ads.perChain['dogecoin-mainnet'].accumulatedSats).toBe(5_000_000);
        // the stored preference stays null: accrual never pins the default
        expect(next.ads.perChain['dogecoin-mainnet'].perTxAmountSats).toBe(null);
    });

    it('BTC crosses the 25,000 trigger on the 25th tx, not the 24th', () => {
        let s = seeded();
        for (let i = 0; i < 24; i++) {
            s = stepAdsAccumulator(s, 'bitcoin-mainnet', { donationIncluded: false, chainRegistry });
        }
        expect(s.ads.perChain['bitcoin-mainnet'].accumulatedSats).toBe(24_000);
        expect(resolveAdsForNextTx(s, 'bitcoin-mainnet', chainRegistry).donationAmount).toBe(0);
        s = stepAdsAccumulator(s, 'bitcoin-mainnet', { donationIncluded: false, chainRegistry });
        expect(resolveAdsForNextTx(s, 'bitcoin-mainnet', chainRegistry).donationAmount).toBe(25_000);
    });

    it('a donation tx banks the accumulator and restarts from the per-tx amount', () => {
        let s = seeded();
        for (let i = 0; i < 25; i++) {
            s = stepAdsAccumulator(s, 'bitcoin-mainnet', { donationIncluded: false, chainRegistry });
        }
        s = stepAdsAccumulator(s, 'bitcoin-mainnet', { donationIncluded: true, chainRegistry });
        const state = s.ads.perChain['bitcoin-mainnet'];
        expect(state.lifetimeDonatedSats).toBe(25_000);
        expect(state.accumulatedSats).toBe(1000);
    });

    it('a user override drives the accrual instead of the descriptor', () => {
        const base = seeded();
        const tuned = {
            ...base,
            ads: {
                ...base.ads,
                perChain: {
                    ...base.ads.perChain,
                    'dogecoin-mainnet': { ...base.ads.perChain['dogecoin-mainnet'], perTxAmountSats: 7 },
                },
            },
        };
        const next = stepAdsAccumulator(tuned, 'dogecoin-mainnet', {
            donationIncluded: false,
            chainRegistry,
        });
        expect(next.ads.perChain['dogecoin-mainnet'].accumulatedSats).toBe(7);
    });
});

describe('updateSettings normalizes values equal to the release default (§36.6)', () => {
    it('writing the default value stores null; a real override stores the number', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());

        // "Set" DOGE per-tx to exactly the descriptor default: not an override.
        let s = await updateSettings(vault, {
            ads: { perChain: { 'dogecoin-mainnet': { perTxAmountSats: 5_000_000 } } },
        });
        expect(s.ads.perChain['dogecoin-mainnet'].perTxAmountSats).toBe(null);

        // A differing value is a real override and survives.
        s = await updateSettings(vault, {
            ads: { perChain: { 'dogecoin-mainnet': { perTxAmountSats: 42 } } },
        });
        expect(s.ads.perChain['dogecoin-mainnet'].perTxAmountSats).toBe(42);
    });

    it('same rule for fee preferences', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());
        const s = await updateSettings(vault, {
            fees: { 'bitcoin-mainnet': { strategy: 'normal', rbfByDefault: false } },
        });
        expect(s.fees['bitcoin-mainnet'].strategy).toBe(null);      // equals descriptor default
        expect(s.fees['bitcoin-mainnet'].rbfByDefault).toBe(false); // differs (BTC default true)
    });
});

describe('the vault stores settings sparse (§35.10)', () => {
    it('a pristine default record persists as schemaVersion only', async () => {
        const vault = await makeVault();
        await vault.settings.put(createDefaultSettings());
        expect(vault._doc.settings).toEqual({ schemaVersion: 3 });
        // ...and reads back as the full record.
        expect(await vault.settings.get()).toEqual(createDefaultSettings());
    });

    it('per-chain entries survive deflation so the active-chain set is preserved', async () => {
        const vault = await makeVault();
        await vault.settings.put(seeded());
        expect(Object.keys(vault._doc.settings.fees).sort())
            .toEqual(['bitcoin-mainnet', 'dogecoin-mainnet']);
        // null preference fields are dropped from storage...
        expect(vault._doc.settings.fees['bitcoin-mainnet']).toEqual({});
        // ...but the read path still exposes the entry for consumers.
        const full = await vault.settings.get();
        expect(full.fees['bitcoin-mainnet']).toBeDefined();
    });
});
