// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    assertReferencedOfferActionable,
    OFFER_LIFECYCLE_REFUSAL,
} from '../../../packages/core/src/flows/marketExpiry.js';

// The indexer records a SWAP cancel or edit of a swap that is not open as
// invalid ("swap not open") and keeps the fee, so a match or cancel that
// lands while the confirm page is open must be refused at signing.
const status = {
    last_block: { TLTC: 800 },
    chain_tip: { TLTC: 800 },
    last_block_time: { TLTC: 4_000 },
};

function registryFor(state) {
    const sdk = {
        explorer: { coin: 'TLTC' },
        getStatus: vi.fn(async () => status),
        getAction: vi.fn(async () => ({ state })),
    };
    return { get: () => sdk };
}

function swapReference(version) {
    return { action: 'SWAP', params: { VERSION: version, SWAP_ACTION_INDEX: '9' } };
}

describe('cancel or edit of a swap that is no longer open', () => {
    it.each([
        ['complete', 'This swap has already been completed.'],
        ['filled', 'This swap has already been completed.'],
        ['settled', 'This swap has already been completed.'],
        ['cancelled', 'This swap has already been cancelled.'],
    ])('refuses a cancel of a %s swap', async (swapStatus, message) => {
        const thrown = await assertReferencedOfferActionable({
            sdkRegistry: registryFor({ status: swapStatus, expiration: 9_000 }),
            chainId: 'litecoin-testnet',
            actionData: swapReference('1'),
        }).then(() => null, (err) => err);

        expect(thrown?.name).toBe(OFFER_LIFECYCLE_REFUSAL);
        expect(thrown?.message).toBe(message);
    });

    it('refuses an edit of a completed swap', async () => {
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor({ status: 'complete' }),
            chainId: 'litecoin-testnet',
            actionData: swapReference('2'),
        })).rejects.toThrow('This swap has already been completed.');
    });

    it('lets a cancel of an open swap through', async () => {
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor({ status: 'open', expiration: 9_000 }),
            chainId: 'litecoin-testnet',
            actionData: swapReference('1'),
        })).resolves.toBeUndefined();
    });
});
