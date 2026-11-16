// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Patches sent while another is still being written all land: each one
// reads the record the previous one wrote.

import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';
import { commitAdsStep } from '../../../packages/core/src/flows/ads.js';
import { ensureSettings, seedSettingsForChains } from '../../../packages/core/src/flows/seedSettings.js';
import { activateChain } from '../../../packages/core/src/flows/activateChain.js';
import {
    rollbackSettingsSeed,
    settingsSeedDelta,
} from '../../../packages/core/src/flows/_persistHdWallet.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function slowVault(initial = createDefaultSettings()) {
    let record = structuredClone(initial);
    return {
        settings: {
            async get() { await tick(); return structuredClone(record); },
            async put(next) { await tick(); record = structuredClone(next); },
        },
        read: () => record,
    };
}

describe('updateSettings with patches in flight together', () => {
    it('keeps every patch', async () => {
        const vault = slowVault();
        await Promise.all([
            updateSettings(vault, { privacy: { hapticsEnabled: false } }),
            updateSettings(vault, { privacy: { priceDataEnabled: false } }),
            updateSettings(vault, { fiatCurrency: 'EUR' }),
            updateSettings(vault, { learnMode: true }),
        ]);
        const saved = vault.read();
        expect(saved.privacy.hapticsEnabled).toBe(false);
        expect(saved.privacy.priceDataEnabled).toBe(false);
        expect(saved.fiatCurrency).toBe('EUR');
        expect(saved.learnMode).toBe(true);
    });

    it('lets the next patch run after one is rejected', async () => {
        const vault = slowVault();
        const bad = updateSettings(vault, { theme: 'not-a-theme' });
        const good = updateSettings(vault, { learnMode: true });
        await expect(bad).rejects.toThrow(/invalid settings/);
        await good;
        expect(vault.read().learnMode).toBe(true);
    });
});

describe('other settings writers share the same queue', () => {
    const registry = defaultRegistry();
    const BTC = 'bitcoin-mainnet';
    const LTC = 'litecoin-mainnet';

    function adsVault() {
        const initial = seedSettingsForChains(createDefaultSettings(), registry, [BTC]);
        initial.ads.enabled = true;
        initial.ads.perChain[BTC].accumulatedSats = 25000;
        return slowVault(initial);
    }

    it.each([
        ['ADS first', (vault) => [
            commitAdsStep({ vault, chainId: BTC, donationIncluded: false, chainRegistry: registry }),
            ensureSettings(vault, registry, [BTC, LTC]),
        ]],
        ['seeding first', (vault) => [
            ensureSettings(vault, registry, [BTC, LTC]),
            commitAdsStep({ vault, chainId: BTC, donationIncluded: false, chainRegistry: registry }),
        ]],
    ])('ensureSettings and an ADS step both land when started together: %s', async (_label, operations) => {
        const vault = adsVault();
        await Promise.all(operations(vault));
        expect(vault.read().ads.perChain[BTC]).toMatchObject({ accumulatedSats: 26000, lifetimeTxCount: 1 });
        expect(vault.read().ads.perChain[LTC]).toBeDefined();
        expect(vault.read().fees[LTC]).toBeDefined();
    });

    it('activateChain and an ADS step both land when started together', async () => {
        const vault = adsVault();
        vault.wallets = { get: async () => ({ id: 'w1' }) };
        vault.accounts = { findBy: async () => [] };
        await Promise.all([
            activateChain({
                walletId: 'w1', chainId: LTC, signer: {}, vault, chainRegistry: registry, sdkRegistry: {},
            }),
            commitAdsStep({ vault, chainId: BTC, donationIncluded: false, chainRegistry: registry }),
        ]);
        expect(vault.read().ads.perChain[BTC]).toMatchObject({ accumulatedSats: 26000, lifetimeTxCount: 1 });
        expect(vault.read().ads.perChain[LTC]).toBeDefined();
        expect(vault.read().fees[LTC]).toBeDefined();
    });

    it('wallet setup rollback removes only unchanged entries it seeded', async () => {
        const before = seedSettingsForChains(createDefaultSettings(), registry, [BTC]);
        before.ads.enabled = true;
        const seeded = seedSettingsForChains(before, registry, [BTC, LTC]);
        const current = structuredClone(seeded);
        current.ads.perChain[BTC].accumulatedSats = 26000;
        current.ads.perChain[BTC].lifetimeTxCount = 1;
        const vault = slowVault(current);

        await rollbackSettingsSeed(vault, settingsSeedDelta(before, seeded, [BTC, LTC]));

        expect(vault.read().ads.perChain[BTC]).toMatchObject({ accumulatedSats: 26000, lifetimeTxCount: 1 });
        expect(vault.read().ads.perChain[LTC]).toBeUndefined();
        expect(vault.read().fees[LTC]).toBeUndefined();
    });

    it('a block and a patch in flight together both land', async () => {
        const { addBlockedOrigin } = await import('../../../packages/core/src/flows/blocklist.js');
        const vault = slowVault();
        vault.connectedSites = { list: async () => [], findBy: async () => [], delete: async () => {} };
        await Promise.all([
            addBlockedOrigin({ vault, origin: 'https://evil.example' }),
            updateSettings(vault, { learnMode: true }),
        ]);
        const saved = vault.read();
        expect(saved.blockedOrigins).toContain('https://evil.example');
        expect(saved.learnMode).toBe(true);
    });

    const CUSTOM = Object.freeze({
        id: 'forkcoin-regtest',
        coin: 'forkcoin',
        displayName: 'ForkCoin Regtest',
        networkKind: 'regtest',
        color: '#A1B2C3',
        icon: '',
        derivationPaths: { p2pkh: "m/44'/0'/A'/C/I" },
        addressTypes: ['p2pkh'],
        defaultAddressType: 'p2pkh',
        feeStrategy: {
            unit: 'sats-per-kbyte',
            supportedStrategies: ['low', 'normal', 'fast'],
            defaultStrategy: 'normal',
            rbfSupported: false,
        },
        supportedActions: ['SEND'],
        uriScheme: 'forkcoin',
        wifVersionByte: 0xef,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 18081 },
        hub: { defaultUrl: 'http://localhost', defaultPort: 18082 },
        adsDonationAddress: 'PLACEHOLDER_REPLACE_BEFORE_MAINNET',
    });
    const OVERRIDE = Object.freeze({
        explorerUrl: 'http://10.0.0.9:18080',
        encoderUrl: 'http://10.0.0.9:18081',
        hubUrl: 'http://10.0.0.9:18082',
        custom: true,
    });

    it('a custom-chain add and a patch in flight together both land', async () => {
        const { addCustomChain } = await import('../../../packages/core/src/flows/customChains.js');
        const { ChainRegistry } = await import('../../../packages/core/src/registry/index.js');
        const vault = slowVault();
        await Promise.all([
            addCustomChain({ vault, chainRegistry: new ChainRegistry(), descriptor: CUSTOM }),
            updateSettings(vault, { learnMode: true }),
            updateSettings(vault, { fiatCurrency: 'EUR' }),
        ]);
        const saved = vault.read();
        expect(saved.customChains.map((d) => d.id)).toEqual([CUSTOM.id]);
        expect(saved.learnMode).toBe(true);
        expect(saved.fiatCurrency).toBe('EUR');
    });

    it('a custom-chain removal and a patch in flight together both land', async () => {
        const { addCustomChain, removeCustomChain } = await import('../../../packages/core/src/flows/customChains.js');
        const { ChainRegistry } = await import('../../../packages/core/src/registry/index.js');
        const vault = slowVault();
        const chainRegistry = new ChainRegistry();
        await addCustomChain({ vault, chainRegistry, descriptor: CUSTOM });
        await vault.settings.put({ ...vault.read(), sdkEndpoints: { [CUSTOM.id]: { ...OVERRIDE } } });
        await Promise.all([
            removeCustomChain({ vault, chainRegistry, chainId: CUSTOM.id }),
            updateSettings(vault, { learnMode: true }),
        ]);
        const saved = vault.read();
        expect(saved.customChains).toEqual([]);
        expect(Object.hasOwn(saved.sdkEndpoints ?? {}, CUSTOM.id)).toBe(false);
        expect(saved.learnMode).toBe(true);
    });

    it('a rolled-back custom-chain add keeps a patch made alongside it', async () => {
        const { addCustomChain } = await import('../../../packages/core/src/flows/customChains.js');
        const vault = slowVault();
        const chainRegistry = { has: () => false, addCustom: () => { throw new Error('registered elsewhere'); } };
        const results = await Promise.allSettled([
            addCustomChain({ vault, chainRegistry, descriptor: CUSTOM }),
            updateSettings(vault, { learnMode: true }),
        ]);
        expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
        const saved = vault.read();
        expect(saved.customChains ?? []).toEqual([]);
        expect(saved.learnMode).toBe(true);
    });
});
