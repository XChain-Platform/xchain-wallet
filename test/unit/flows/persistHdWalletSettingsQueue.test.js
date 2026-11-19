// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Wallet setup writes the Settings record twice: it seeds per-chain entries
// before the wallet graph, and undoes them if a later write fails. Both go
// through the settings write queue, so an ADS step that lands in between is
// kept instead of being overwritten with an older copy of the record.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { commitAdsStep } from '../../../packages/core/src/flows/ads.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { serializeSettingsWrites } from '../../../packages/core/src/flows/settings.js';
import { ensureSettings, seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { rollbackSettingsSeed, settingsSeedDelta } from '../../../packages/core/src/flows/_persistHdWallet.js';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { ChainRegistry, defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function slowVault(initial) {
    let record = structuredClone(initial);
    return {
        settings: {
            async get() { await tick(); return structuredClone(record); },
            async put(next) { await tick(); record = structuredClone(next); },
        },
        read: () => record,
    };
}

describe('rolling back a wallet setup seed', () => {
    it('keeps an ADS step that lands while the rollback is in flight', async () => {
        const registry = defaultRegistry();
        const before = seedSettingsForChains(createDefaultSettings(), registry, [BTC]);
        before.ads.perTransaction = '1';
        before.ads.queued = '25';
        const seeded = seedSettingsForChains(before, registry, [BTC, LTC]);
        const vault = slowVault(seeded);

        await Promise.all([
            rollbackSettingsSeed(vault, settingsSeedDelta(before, seeded, [BTC, LTC])),
            commitAdsStep({ vault, donationIncluded: false }),
        ]);

        const saved = vault.read();
        expect(saved.ads).toMatchObject({ queued: '26', donationCount: 0 });
        expect(saved.fees[BTC]).toBeDefined();
        expect(saved.fees[LTC]).toBeUndefined();
    });
});

const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};
const sdkRegistry = { get: () => ({ wallet: { deriveAddress: (pub, { type }) => `${type}_${pub}` } }) };

async function waitFor(predicate, limitMs) {
    const started = Date.now();
    while (!predicate() && Date.now() - started < limitMs) await new Promise((r) => setTimeout(r, 25));
    return predicate();
}

describe('wallet setup seeding waits for settings writes already queued', () => {
    it('writes no settings and no wallet until the queue ahead of it drains', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
        await vault.open();
        const registry = new ChainRegistry();
        await ensureSettings(vault, registry, ['bitcoin-regtest']);

        const guardedPut = vi.spyOn(vault, 'putManyGuarded');
        let release;
        const held = serializeSettingsWrites(vault, () => new Promise((resolve) => { release = resolve; }));
        const imported = importMnemonic({
            password: 'correct-horse-battery-staple',
            mnemonic: generateBip39Mnemonic(128),
            vault,
            chainRegistry: registry,
            sdkRegistry,
            activeChainIds: ['bitcoin-regtest'],
            name: 'First',
            kdfParams: LOW_COST_KDF_PARAMS,
        });

        const wroteEarly = await waitFor(() => guardedPut.mock.calls.length > 0, 3000);
        expect(wroteEarly).toBe(false);

        release();
        await held;
        await imported;
        expect(guardedPut).toHaveBeenCalledTimes(1);
    });
});

describe('a failed wallet setup on a vault that already has settings', () => {
    it('removes the chain entries it seeded and keeps the ones that were already there', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: new Uint8Array(32).fill(9) });
        await vault.open();
        const registry = new ChainRegistry();
        await ensureSettings(vault, registry, ['bitcoin-regtest']);
        backend.save = async () => { throw new Error('address save failed'); };

        await expect(importMnemonic({
            password: 'correct-horse-battery-staple',
            mnemonic: generateBip39Mnemonic(128),
            vault,
            chainRegistry: registry,
            sdkRegistry,
            activeChainIds: ['bitcoin-regtest', 'litecoin-regtest'],
            name: 'First',
            kdfParams: LOW_COST_KDF_PARAMS,
        })).rejects.toThrow('address save failed');

        const settings = await vault.settings.get();
        expect(settings.fees['bitcoin-regtest']).toBeDefined();
        expect(settings.fees['litecoin-regtest']).toBeUndefined();
    });
});
