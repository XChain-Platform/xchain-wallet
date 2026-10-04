// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// createPollAction and castBallotAction guard their inputs before any signing
// work, then hand the builder output to submitAction as a VOTE action.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { submitAction } = vi.hoisted(() => ({ submitAction: vi.fn() }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({ submitAction }));

import { createPollAction, castBallotAction } from '../../../packages/core/src/flows/voteActions.js';

const FROM = { address: 'bc1qsource', publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0" };

function makeOpts(extra = {}) {
    const voting = {
        createPollParams: vi.fn((i) => ({ built: 'poll', ...i })),
        castBallotParams: vi.fn((i) => ({ built: 'ballot', ...i })),
    };
    const sdkRegistry = { get: vi.fn(() => ({ voting })) };
    return { voting, sdkRegistry, opts: { sdkRegistry, chainId: 'btc', from: FROM, params: {}, ...extra } };
}

beforeEach(() => {
    submitAction.mockReset();
    submitAction.mockResolvedValue({ txid: 'tx' });
});

describe('createPollAction guards', () => {
    it('rejects a missing params.tick before submitting', async () => {
        const { opts } = makeOpts({ params: { question: 'q' } });
        await expect(createPollAction(opts)).rejects.toThrow('params.tick is required');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('rejects a missing sdkRegistry or chainId', async () => {
        const { opts } = makeOpts({ params: { tick: 'GOV' } });
        await expect(createPollAction({ ...opts, sdkRegistry: undefined })).rejects.toThrow('sdkRegistry is required');
        await expect(createPollAction({ ...opts, chainId: undefined })).rejects.toThrow('chainId is required');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('rejects when createPollParams is unavailable', async () => {
        const { opts } = makeOpts({ params: { tick: 'GOV' } });
        opts.sdkRegistry = { get: () => ({ voting: {} }) };
        await expect(createPollAction(opts)).rejects.toThrow('sdk.voting.createPollParams is unavailable');
        opts.sdkRegistry = { get: () => ({}) };
        await expect(createPollAction(opts)).rejects.toThrow('sdk.voting.createPollParams is unavailable');
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe('createPollAction submit', () => {
    it('submits a VOTE action with the builder params and a truncated summary', async () => {
        const question = 'x'.repeat(60);
        const { opts, voting, sdkRegistry } = makeOpts({ params: { tick: 'GOV', question } });
        await createPollAction(opts);
        expect(sdkRegistry.get).toHaveBeenCalledWith('btc');
        expect(voting.createPollParams).toHaveBeenCalledWith(opts.params);
        expect(submitAction).toHaveBeenCalledTimes(1);
        const call = submitAction.mock.calls[0][0];
        expect(call.actionData).toEqual({ action: 'VOTE', params: { built: 'poll', tick: 'GOV', question } });
        expect(call.pendingTxMeta.actionSummary).toBe(`Create GOV governance poll "${'x'.repeat(40)}"`);
        expect(call.pendingTxMeta.fromAddress).toBe('bc1qsource');
    });

    it('omits the question from the summary when absent', async () => {
        const { opts } = makeOpts({ params: { tick: 'GOV' } });
        await createPollAction(opts);
        expect(submitAction.mock.calls[0][0].pendingTxMeta.actionSummary).toBe('Create GOV governance poll');
    });

    it('omits pendingTxMeta when trackPendingTx is false', async () => {
        const { opts } = makeOpts({ params: { tick: 'GOV' }, trackPendingTx: false });
        await createPollAction(opts);
        expect(submitAction.mock.calls[0][0].pendingTxMeta).toBeUndefined();
    });
});

describe('castBallotAction', () => {
    it.each([undefined, null])('rejects pollRef %s before submitting', async (pollRef) => {
        const { opts } = makeOpts({ params: { pollRef, ballot: [0] } });
        await expect(castBallotAction(opts)).rejects.toThrow('params.pollRef is required');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('accepts pollRef 0 and summarizes it', async () => {
        const { opts, voting } = makeOpts({ params: { pollRef: 0, ballot: [1] } });
        await castBallotAction(opts);
        expect(voting.castBallotParams).toHaveBeenCalledWith(opts.params);
        const call = submitAction.mock.calls[0][0];
        expect(call.actionData).toEqual({ action: 'VOTE', params: { built: 'ballot', pollRef: 0, ballot: [1] } });
        expect(call.pendingTxMeta.actionSummary).toBe('Vote on poll 0');
    });

    it('summarizes a non-zero pollRef', async () => {
        const { opts } = makeOpts({ params: { pollRef: 'abc:1', ballot: [1] } });
        await castBallotAction(opts);
        expect(submitAction.mock.calls[0][0].pendingTxMeta.actionSummary).toBe('Vote on poll abc:1');
    });
});

describe('encoderOpts fee passthrough', () => {
    it('adds fee, feePerKb and rbf only when defined', async () => {
        const { opts } = makeOpts({ params: { tick: 'GOV' } });
        await createPollAction(opts);
        const bare = submitAction.mock.calls[0][0].encoderOpts;
        expect(bare).toEqual({ pubkey: '02aa', sourceAddress: 'bc1qsource', change: 'bc1qsource' });
        expect(Object.keys(bare)).not.toEqual(expect.arrayContaining(['fee', 'feePerKb', 'rbf']));

        await createPollAction({ ...opts, fee: 0, feePerKb: 5, rbf: false });
        expect(submitAction.mock.calls[1][0].encoderOpts).toMatchObject({ fee: 0, feePerKb: 5, rbf: false });
    });

    it('applies the same passthrough to castBallotAction', async () => {
        const { opts } = makeOpts({ params: { pollRef: 1, ballot: [0] } });
        await castBallotAction({ ...opts, rbf: true });
        const enc = submitAction.mock.calls[0][0].encoderOpts;
        expect(enc.rbf).toBe(true);
        expect('fee' in enc).toBe(false);
        expect('feePerKb' in enc).toBe(false);
    });
});
