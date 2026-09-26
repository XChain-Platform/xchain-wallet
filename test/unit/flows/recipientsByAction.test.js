// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/recipientsByAction (Cluster O FOLLOWUP 2). Derives the
// DIVIDEND/AIRDROP recipient sets that aren't carried on-row: DIVIDEND
// via sdk.getHolders(tick), AIRDROP via the referenced LIST action.
// Covers pre-resolved fast paths, action-lookup fallbacks, dedupe,
// source exclusion, envelope tolerance, and the required-arg guards.

import { describe, it, expect, vi } from 'vitest';
import {
    getDividendRecipients,
    getAirdropRecipients,
} from '../../../packages/core/src/flows/recipientsByAction.js';

function mkRegistry(sdk) {
    return { get: () => sdk };
}

describe('flows/recipientsByAction getDividendRecipients', () => {
    it('uses a pre-resolved tick and returns deduped holders with balances', async () => {
        const sdk = {
            getHolders: vi.fn(async () => ({
                holders: [
                    { address: 'addr1', balance: 100 },
                    { address: 'addr2', balance: 50 },
                    { address: 'addr1', balance: 100 }, // dup
                ],
            })),
            getAction: vi.fn(),
        };
        const res = await getDividendRecipients({ sdkRegistry: mkRegistry(sdk), chainId: 'c', tick: 'MYTOKEN' });
        expect(res.tick).toBe('MYTOKEN');
        expect(res.recipients).toEqual([
            { address: 'addr1', balance: '100' },
            { address: 'addr2', balance: '50' },
        ]);
        expect(sdk.getAction).not.toHaveBeenCalled();
        expect(res.snapshotNote).toMatch(/current state/i);
    });

    it('resolves tick + source from the action when tick is not pre-supplied, excluding the source address', async () => {
        const sdk = {
            getAction: vi.fn(async () => ({ params: { TICK: 'MYTOKEN', SOURCE: 'issuerAddr' } })),
            getHolders: vi.fn(async () => [
                { address: 'issuerAddr', balance: '999' }, // excluded: it is the source
                { address: 'holderA', balance: '5' },
            ]),
        };
        const res = await getDividendRecipients({ sdkRegistry: mkRegistry(sdk), chainId: 'c', actionIndex: '42' });
        expect(sdk.getAction).toHaveBeenCalledWith('42');
        expect(res.source).toBe('issuerAddr');
        expect(res.recipients).toEqual([{ address: 'holderA', balance: '5' }]);
    });

    it('accepts a bare holders array and rows without a balance field', async () => {
        const sdk = { getHolders: async () => [{ address: 'a1' }, { ADDRESS: 'a2', BALANCE: 7 }] };
        const res = await getDividendRecipients({ sdkRegistry: mkRegistry(sdk), chainId: 'c', tick: 'T' });
        expect(res.recipients).toEqual([{ address: 'a1' }, { address: 'a2', balance: '7' }]);
    });

    it('throws when neither tick nor actionIndex is provided', async () => {
        const sdk = { getHolders: async () => [] };
        await expect(getDividendRecipients({ sdkRegistry: mkRegistry(sdk), chainId: 'c' }))
            .rejects.toThrow(/either tick or actionIndex is required/);
    });

    it('throws when the looked-up action carries no TICK', async () => {
        const sdk = { getAction: async () => ({ params: {} }), getHolders: async () => [] };
        await expect(getDividendRecipients({ sdkRegistry: mkRegistry(sdk), chainId: 'c', actionIndex: '9' }))
            .rejects.toThrow(/has no TICK field/);
    });

    it('guards sdkRegistry, chainId, and an unregistered SDK', async () => {
        await expect(getDividendRecipients({ chainId: 'c', tick: 'T' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(getDividendRecipients({ sdkRegistry: mkRegistry({}), tick: 'T' })).rejects.toThrow(/chainId is required/);
        await expect(getDividendRecipients({ sdkRegistry: { get: () => null }, chainId: 'c', tick: 'T' }))
            .rejects.toThrow(/SDK not registered/);
    });
});

describe('flows/recipientsByAction getAirdropRecipients', () => {
    it('reads historical recipients from production-shaped AIRDROP credits', async () => {
        const action = {
            action: 'AIRDROP',
            action_index: 42,
            list_action_index: 7,
            tick: 'XCP',
            credits: [
                { address: 'addr1', tick: 'XCP', amount: '10' },
                { address: 'addr2', tick: 'XCP', amount: '10' },
                { address: 'addr1', tick: 'XCP', amount: '5' },
            ],
        };
        const sdk = { getAction: vi.fn(async () => action) };

        const res = await getAirdropRecipients({
            sdkRegistry: mkRegistry(sdk),
            chainId: 'c',
            actionIndex: '42',
            listActionIndex: '7',
        });

        expect(sdk.getAction).toHaveBeenCalledTimes(1);
        expect(sdk.getAction).toHaveBeenCalledWith('42');
        expect(res.listActionIndex).toBe('7');
        expect(res.recipients).toEqual([{ address: 'addr1' }, { address: 'addr2' }]);
    });

    it('falls back to the row list index when the action response omits it', async () => {
        const sdk = { getAction: vi.fn(async () => ({ credits: [] })) };
        const res = await getAirdropRecipients({
            sdkRegistry: mkRegistry(sdk),
            chainId: 'c',
            actionIndex: '42',
            listActionIndex: '7',
        });
        expect(res.listActionIndex).toBe('7');
    });

    it('throws when actionIndex is not provided', async () => {
        await expect(getAirdropRecipients({ sdkRegistry: mkRegistry({ getAction: async () => ({}) }), chainId: 'c' }))
            .rejects.toThrow(/actionIndex is required/);
    });

    it('guards sdkRegistry, chainId, and an unregistered SDK', async () => {
        await expect(getAirdropRecipients({ chainId: 'c', actionIndex: '42' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(getAirdropRecipients({ sdkRegistry: mkRegistry({}), actionIndex: '42' })).rejects.toThrow(/chainId is required/);
        await expect(getAirdropRecipients({ sdkRegistry: { get: () => null }, chainId: 'c', actionIndex: '42' }))
            .rejects.toThrow(/SDK not registered/);
    });
});
