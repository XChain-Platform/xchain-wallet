// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Delegate and clear composers for standing VOTE delegations: input guards,
// summaries, builder selection, and the signing path chosen from the source.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitCalls } = vi.hoisted(() => ({ submitCalls: [] }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: async (opts) => { submitCalls.push(opts); return { txid: 'tx' }; },
}));

import {
    delegateVoteAction,
    clearVoteDelegationAction,
} from '../../../packages/core/src/flows/voteActions.js';

const DELEGATE_TO = 'bcrt1qdelegatetarget0000000000000000000';

function harness() {
    const voting = {
        delegateParams: vi.fn((i) => ({ version: 3, built: 'delegate', ...i })),
        clearDelegationParams: vi.fn((i) => ({ version: 3, built: 'clear', ...i })),
    };
    const sdkRegistry = { get: vi.fn(() => ({ voting })) };
    return { voting, sdkRegistry };
}

function baseOpts(sdkRegistry, params, from) {
    return {
        sdkRegistry,
        chainId: 'regtest',
        walletId: 'w1',
        from: from ?? { address: 'bcrt1qsource', publicKey: '02aa', derivationPath: "m/84'/1'/0'/0/0" },
        params,
    };
}

describe('delegateVoteAction', () => {
    let h;
    beforeEach(() => { submitCalls.length = 0; h = harness(); });

    it('rejects when params.tick is missing', async () => {
        const opts = baseOpts(h.sdkRegistry, { delegateTo: DELEGATE_TO });
        await expect(delegateVoteAction(opts)).rejects.toThrow('params.tick is required');
        expect(submitCalls).toHaveLength(0);
    });

    it('rejects when params.delegateTo is missing', async () => {
        const opts = baseOpts(h.sdkRegistry, { tick: 'GOV' });
        await expect(delegateVoteAction(opts)).rejects.toThrow('params.delegateTo is required');
        expect(submitCalls).toHaveLength(0);
    });

    it('summarizes with the tick and the first 12 characters of delegateTo', async () => {
        await delegateVoteAction(baseOpts(h.sdkRegistry, { tick: 'GOV', delegateTo: DELEGATE_TO }));
        const summary = submitCalls[0].pendingTxMeta.actionSummary;
        expect(summary).toBe(`Delegate GOV votes to ${DELEGATE_TO.slice(0, 12)}…`);
        expect(summary).not.toContain(DELEGATE_TO.slice(0, 13));
    });

    it('builds with delegateParams and submits the result as a VOTE action', async () => {
        const params = { tick: 'GOV', delegateTo: DELEGATE_TO };
        await delegateVoteAction(baseOpts(h.sdkRegistry, params));
        expect(h.voting.delegateParams).toHaveBeenCalledWith(params);
        expect(h.voting.clearDelegationParams).not.toHaveBeenCalled();
        expect(submitCalls[0].actionData).toEqual({
            action: 'VOTE',
            params: { version: 3, built: 'delegate', ...params },
        });
    });
});

describe('clearVoteDelegationAction', () => {
    let h;
    beforeEach(() => { submitCalls.length = 0; h = harness(); });

    it('rejects when params.tick is missing', async () => {
        await expect(clearVoteDelegationAction(baseOpts(h.sdkRegistry, {})))
            .rejects.toThrow('params.tick is required');
        expect(submitCalls).toHaveLength(0);
    });

    it('summarizes with the tick', async () => {
        await clearVoteDelegationAction(baseOpts(h.sdkRegistry, { tick: 'GOV' }));
        expect(submitCalls[0].pendingTxMeta.actionSummary).toBe('Clear GOV vote delegation');
    });

    it('builds with clearDelegationParams and submits the result as a VOTE action', async () => {
        const params = { tick: 'GOV' };
        await clearVoteDelegationAction(baseOpts(h.sdkRegistry, params));
        expect(h.voting.clearDelegationParams).toHaveBeenCalledWith(params);
        expect(h.voting.delegateParams).not.toHaveBeenCalled();
        expect(submitCalls[0].actionData).toEqual({
            action: 'VOTE',
            params: { version: 3, built: 'clear', ...params },
        });
    });
});

describe('signing path selection', () => {
    const cases = [
        ['delegateVoteAction', delegateVoteAction, { tick: 'GOV', delegateTo: DELEGATE_TO }],
        ['clearVoteDelegationAction', clearVoteDelegationAction, { tick: 'GOV' }],
    ];

    beforeEach(() => { submitCalls.length = 0; });

    it.each(cases)('%s uses the derivation path when the source has one', async (_n, fn, params) => {
        const { sdkRegistry } = harness();
        await fn(baseOpts(sdkRegistry, params));
        expect(submitCalls[0].signingPaths).toEqual([{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }]);
    });

    it.each(cases)('%s uses the addressId when the source has no derivation path', async (_n, fn, params) => {
        const { sdkRegistry } = harness();
        const from = { address: 'bcrt1qsource', publicKey: '02aa', addressId: 'addr-1' };
        await fn(baseOpts(sdkRegistry, params, from));
        expect(submitCalls[0].signingPaths).toEqual([{ inputIndex: 0, addressId: 'addr-1' }]);
    });
});
