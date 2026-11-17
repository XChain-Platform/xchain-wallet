// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Automatic donation routing over the shipped descriptors: the one wallet-wide
// recipient (Protocol, Community, Explorer) picks the registry's DONATE1,
// DONATE2 or EXPLORER address on the network of the send that carries it. Only
// mainnet sends pay: a testnet or regtest send carries no donation at all.

import { describe, expect, it, vi } from 'vitest';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import { dogecoinDescriptors } from '../../../packages/core/src/registry/descriptors/dogecoin.js';
import { litecoinDescriptors } from '../../../packages/core/src/registry/descriptors/litecoin.js';
import { ADS_RECIPIENT_ROLE, resolveAdsPayout } from '../../../packages/core/src/flows/ads.js';
import { ADS_DONATION_ADDRESS_ROLES } from '../../../packages/core/src/registry/validate.js';
import {
    ADS_RECIPIENTS,
    createDefaultSettings,
    deflateSettings,
    inflateSettings,
} from '../../../packages/core/src/schemas/settings.js';

const COINS = [
    ['bitcoin', bitcoinDescriptors],
    ['litecoin', litecoinDescriptors],
    ['dogecoin', dogecoinDescriptors],
];

const settingsFor = (recipient) => {
    const s = createDefaultSettings();
    return { ...s, ads: { ...s.ads, queued: '25', sendAt: '25', ...(recipient ? { recipient } : {}) } };
};
const registryOf = (descriptor) => ({ get: (id) => (id === descriptor.id ? descriptor : undefined) });
const rateLoader = vi.fn(async () => ({ rate: 1, stale: false }));

describe('each recipient maps to one registry role', () => {
    it('covers the three roles exactly', () => {
        expect(ADS_RECIPIENTS.map((r) => ADS_RECIPIENT_ROLE[r]).sort()).toEqual([...ADS_DONATION_ADDRESS_ROLES].sort());
    });
});

describe.each(COINS)('%s donation routing', (_coin, descriptors) => {
    const mainnet = descriptors.find((d) => d.networkKind === 'mainnet');
    const mainnetAddresses = Object.values(mainnet.adsDonationAddresses);

    it('ships three distinct addresses per network and none is shared across networks', () => {
        const all = descriptors.flatMap((d) => ADS_DONATION_ADDRESS_ROLES.map((r) => d.adsDonationAddresses[r]));
        expect(all.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
        expect(new Set(all).size).toBe(all.length);
    });

    it(`${mainnet.id} defaults to its own DONATE1 (Protocol)`, async () => {
        const plan = await resolveAdsPayout({
            settings: settingsFor(), chainId: mainnet.id, chainRegistry: registryOf(mainnet), rateLoader,
        });
        expect(plan).toMatchObject({ canSubmit: true, reason: 'ok', donationAddress: mainnet.adsDonationAddresses.DONATE1 });
    });

    it.each(ADS_RECIPIENTS.map((recipient) => [mainnet.id, recipient]))('%s pays the %s address', async (_id, recipient) => {
        const plan = await resolveAdsPayout({
            settings: settingsFor(recipient), chainId: mainnet.id, chainRegistry: registryOf(mainnet), rateLoader,
        });
        expect(plan.donationAddress).toBe(mainnet.adsDonationAddresses[ADS_RECIPIENT_ROLE[recipient]]);
    });

    // Only mainnet counts: test-network coins never pay the queue mainnet
    // sends built, whichever network the wallet is switched to.
    const nonMainnet = descriptors.filter((d) => d.networkKind !== 'mainnet');
    const cases = nonMainnet.flatMap((d) => ADS_RECIPIENTS.map((recipient) => [d.id, recipient, d]));

    it.each(cases)('%s never pays a %s donation', async (_id, recipient, descriptor) => {
        for (const activeNetwork of ['mainnet', descriptor.networkKind]) {
            const plan = await resolveAdsPayout({
                settings: { ...settingsFor(recipient), activeNetwork },
                chainId: descriptor.id, chainRegistry: registryOf(descriptor), rateLoader,
            });
            expect(plan).toMatchObject({ canSubmit: false, reason: 'test-network', donationAddress: null, donationAmount: 0 });
        }
    });

    it(`${mainnet.id} pays nothing while the wallet is on a test network`, async () => {
        for (const activeNetwork of ['testnet', 'regtest']) {
            const plan = await resolveAdsPayout({
                settings: { ...settingsFor(), activeNetwork }, chainId: mainnet.id, chainRegistry: registryOf(mainnet), rateLoader,
            });
            expect(plan).toMatchObject({ canSubmit: false, reason: 'test-network' });
            expect(mainnetAddresses).not.toContain(plan.donationAddress);
        }
    });
});

describe('the recipient setting persists', () => {
    it('survives a deflate and inflate round trip', async () => {
        const descriptor = litecoinDescriptors.find((d) => d.networkKind === 'mainnet');
        const restored = inflateSettings(deflateSettings(settingsFor('community')));
        expect(restored.ads.recipient).toBe('community');
        const plan = await resolveAdsPayout({
            settings: restored, chainId: descriptor.id, chainRegistry: registryOf(descriptor), rateLoader,
        });
        expect(plan.donationAddress).toBe(descriptor.adsDonationAddresses.DONATE2);
    });
});
