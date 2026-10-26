// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ADS donation routing over the shipped descriptors: the per-chain
// donationAddressRole setting picks DONATE1, DONATE2 or EXPLORER (DONATE1
// when unset), the picked address is the one the donation output pays, and
// a testnet or regtest chain can never resolve to a mainnet address.

import { describe, expect, it } from 'vitest';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import { dogecoinDescriptors } from '../../../packages/core/src/registry/descriptors/dogecoin.js';
import { litecoinDescriptors } from '../../../packages/core/src/registry/descriptors/litecoin.js';
import {
    applyAdsPlanToEncoderOpts,
    resolveAdsPlanForNextTx,
} from '../../../packages/core/src/flows/ads.js';
import { ADS_DONATION_ADDRESS_ROLES } from '../../../packages/core/src/registry/validate.js';
import { deflateSettings, inflateSettings } from '../../../packages/core/src/schemas/settings.js';

const COINS = [
    ['bitcoin', bitcoinDescriptors],
    ['litecoin', litecoinDescriptors],
    ['dogecoin', dogecoinDescriptors],
];

// Accumulator already at the trigger, so the next transaction carries the donation.
const settingsFor = (descriptor, donationAddressRole) => ({
    ads: {
        enabled: true,
        perChain: {
            [descriptor.id]: {
                perTxAmountSats: null,
                triggerAmountSats: null,
                accumulatedSats: descriptor.adsDefaults.triggerAmountSats,
                lifetimeDonatedSats: 0,
                lifetimeTxCount: 25,
                ...(donationAddressRole ? { donationAddressRole } : {}),
            },
        },
    },
});

const registryOf = (descriptor) => ({
    get: (chainId) => (chainId === descriptor.id ? descriptor : undefined),
});

describe.each(COINS)('%s ADS donation routing', (_coin, descriptors) => {
    const mainnet = descriptors.find((d) => d.networkKind === 'mainnet');
    const mainnetAddresses = Object.values(mainnet.adsDonationAddresses);

    it('ships three distinct addresses per network and none is shared across networks', () => {
        const all = descriptors.flatMap((d) => ADS_DONATION_ADDRESS_ROLES.map((r) => d.adsDonationAddresses[r]));
        expect(all.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
        expect(new Set(all).size).toBe(all.length);
    });

    it.each(descriptors.map((d) => [d.id, d]))('%s defaults to its own DONATE1', (_id, descriptor) => {
        const plan = resolveAdsPlanForNextTx(settingsFor(descriptor), descriptor.id, registryOf(descriptor));
        expect(plan).toMatchObject({
            canSubmit: true,
            reason: 'ok',
            donationAddress: descriptor.adsDonationAddresses.DONATE1,
        });
    });

    const nonMainnet = descriptors.filter((d) => d.networkKind !== 'mainnet');
    const cases = nonMainnet.flatMap((d) => ADS_DONATION_ADDRESS_ROLES.map((role) => [d.id, role, d]));

    it.each(cases)('%s pays the chosen %s address and never a mainnet one', (_id, role, descriptor) => {
        const existingOutput = { address: 'recipient', value: 1 };
        const result = applyAdsPlanToEncoderOpts(
            settingsFor(descriptor, role),
            descriptor.id,
            registryOf(descriptor),
            { customOutputs: [existingOutput] },
        );
        expect(result.adsPlan.canSubmit).toBe(true);
        expect(result.encoderOpts.customOutputs).toEqual([
            existingOutput,
            {
                address: descriptor.adsDonationAddresses[role],
                value: descriptor.adsDefaults.triggerAmountSats,
            },
        ]);
        expect(mainnetAddresses).not.toContain(result.adsPlan.donationAddress);
    });

    it('refuses to submit for an unknown role instead of falling back to another address', () => {
        const descriptor = nonMainnet[0];
        const plan = resolveAdsPlanForNextTx(
            settingsFor(descriptor, 'DONATE9'),
            descriptor.id,
            registryOf(descriptor),
        );
        expect(plan.canSubmit).toBe(false);
        expect(plan.donationAddress).toBeNull();
    });
});

describe('donationAddressRole setting persistence', () => {
    it('survives a deflate and inflate round trip', () => {
        const descriptor = litecoinDescriptors.find((d) => d.networkKind === 'testnet');
        const full = inflateSettings(settingsFor(descriptor, 'DONATE2'));
        const restored = inflateSettings(deflateSettings(full));
        expect(restored.ads.perChain[descriptor.id].donationAddressRole).toBe('DONATE2');
        const plan = resolveAdsPlanForNextTx(restored, descriptor.id, registryOf(descriptor));
        expect(plan.donationAddress).toBe(descriptor.adsDonationAddresses.DONATE2);
    });
});
