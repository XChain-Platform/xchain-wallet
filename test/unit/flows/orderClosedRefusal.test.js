// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    assertReferencedOfferActionable,
    OFFER_LIFECYCLE_REFUSAL,
} from '../../../packages/core/src/flows/marketExpiry.js';

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

function referenceTo(action, version) {
    return {
        action,
        params: { VERSION: version, [`${action}_ACTION_INDEX`]: '9' },
    };
}

describe('cancel or edit of an order that is no longer open', () => {
    it.each([
        ['filled', 'This order has already been filled.'],
        ['complete', 'This order has already been filled.'],
        ['cancelled', 'This order has already been cancelled.'],
    ])('refuses a cancel of a %s order', async (orderStatus, message) => {
        const thrown = await assertReferencedOfferActionable({
            sdkRegistry: registryFor({ status: orderStatus, expiration: 9_000 }),
            chainId: 'litecoin-testnet',
            actionData: referenceTo('ORDER', '1'),
        }).then(() => null, (err) => err);

        expect(thrown?.name).toBe(OFFER_LIFECYCLE_REFUSAL);
        expect(thrown?.message).toBe(message);
    });

    it('refuses an edit of a filled order', async () => {
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor({ status: 'filled' }),
            chainId: 'litecoin-testnet',
            actionData: referenceTo('ORDER', '2'),
        })).rejects.toThrow('This order has already been filled.');
    });

    it('lets a cancel of an open order through', async () => {
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor({ status: 'open', expiration: 9_000 }),
            chainId: 'litecoin-testnet',
            actionData: referenceTo('ORDER', '1'),
        })).resolves.toBeUndefined();
    });
});
