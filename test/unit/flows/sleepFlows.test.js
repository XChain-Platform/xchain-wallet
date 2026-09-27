// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-05 SLEEP flows: the v0 (address) / v1 (tick) wire params, and the
// pause-state derivation over the latest SLEEP row (mirrors the
// indexer's RESUME_BLOCK interpretation: -1 indefinite, 0 resumed, a
// future block still paused, a past block resumed).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'sleep-tx-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address, publicKey: from.publicKey,
        derivationPath: from.derivationPath || null, addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { sleepAction } from '../../../packages/core/src/flows/sleepAction.js';
import { sleepStateFor, interpretSleep } from '../../../packages/core/src/flows/sleepQueries.js';

const FROM = { address: 'addr-1', publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };
function opts(params, extra = {}) {
    return {
        vault: {}, walletId: 'w1', password: 'pw', chainRegistry: {}, sdkRegistry: {},
        chainId: 'bitcoin-regtest', from: FROM, params, ...extra,
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'sleep-tx-1' });
});

describe('sleepAction', () => {
    it('composes a v1 tick sleep and forwards prebuiltPsbt', async () => {
        const prebuilt = { psbtHex: 'de', encoding: 'op_return', actionString: 'SLEEP|1|-1|JDOG', version: 1 };
        await sleepAction(opts({ VERSION: '1', RESUME_BLOCK: '-1', TICK: 'JDOG', MEMO: 'pause' }, { prebuiltPsbt: prebuilt }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData).toEqual({ action: 'SLEEP', params: { VERSION: '1', RESUME_BLOCK: '-1', TICK: 'JDOG', MEMO: 'pause' } });
        expect(call.prebuiltPsbt).toBe(prebuilt);
    });

    it('composes a v0 address sleep', async () => {
        await sleepAction(opts({ VERSION: '0', RESUME_BLOCK: '900000' }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.params).toEqual({ VERSION: '0', RESUME_BLOCK: '900000' });
    });

    it('funds a live build from the source and returns change to it', async () => {
        await sleepAction(opts({ VERSION: '0', RESUME_BLOCK: '900000' }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.prebuiltPsbt).toBeUndefined();
        expect(call.encoderOpts).toMatchObject({ pubkey: '02ab', sourceAddress: 'addr-1', change: 'addr-1' });
    });

    it('requires RESUME_BLOCK', async () => {
        await expect(sleepAction(opts({ VERSION: '0' }))).rejects.toThrow(/RESUME_BLOCK/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('requires TICK on a v1 tick sleep', async () => {
        await expect(sleepAction(opts({ VERSION: '1', RESUME_BLOCK: '0' }))).rejects.toThrow(/TICK/);
    });

    it('forwards the host auto-enqueue hook to submitAction', async () => {
        const onBroadcastFailure = vi.fn();
        await sleepAction(opts({ VERSION: '0', RESUME_BLOCK: '900000' }, { onBroadcastFailure }));
        expect(vi.mocked(submitAction).mock.calls[0][0].onBroadcastFailure).toBe(onBroadcastFailure);
    });

    it('accepts RESUME_BLOCK 0 (resume now)', async () => {
        await sleepAction(opts({ VERSION: '1', RESUME_BLOCK: '0', TICK: 'JDOG' }));
        expect(submitAction).toHaveBeenCalled();
    });
});

describe('interpretSleep', () => {
    it('never-slept is active', () => {
        expect(interpretSleep(null, 100)).toEqual({ paused: false, indefinite: false, resumeBlock: null });
    });
    it('-1 is paused indefinitely', () => {
        expect(interpretSleep(-1, 100)).toEqual({ paused: true, indefinite: true, resumeBlock: -1 });
    });
    it('0 is resumed', () => {
        expect(interpretSleep(0, 100)).toEqual({ paused: false, indefinite: false, resumeBlock: 0 });
    });
    it('a future block is still paused', () => {
        expect(interpretSleep(200, 100)).toEqual({ paused: true, indefinite: false, resumeBlock: 200 });
    });
    it('a passed block is resumed', () => {
        expect(interpretSleep(50, 100)).toEqual({ paused: false, indefinite: false, resumeBlock: 50 });
    });
    it('unknown height fails toward paused for a positive block', () => {
        expect(interpretSleep(200, null)).toEqual({ paused: true, indefinite: false, resumeBlock: 200 });
    });
});

function makeSdk(rows) {
    return { get: () => ({ getSleeps: vi.fn(async () => ({ data: rows })) }) };
}

describe('sleepStateFor', () => {
    it('returns null resumeBlock when never slept', async () => {
        const s = await sleepStateFor({ sdkRegistry: makeSdk([]), chainId: 'c', query: 'JDOG', type: 'token' });
        expect(s.resumeBlock).toBeNull();
    });

    it('picks the latest valid row by action_index', async () => {
        const s = await sleepStateFor({
            sdkRegistry: makeSdk([
                { action_index: 10, resume_block: -1, status: 'valid' },
                { action_index: 42, resume_block: 0, status: 'valid' }, // newest: resumed
                { action_index: 30, resume_block: 900, status: 'valid' },
            ]),
            chainId: 'c', query: 'JDOG', type: 'token',
        });
        expect(s.resumeBlock).toBe(0);
        expect(s.actionIndex).toBe(42);
    });

    it('ignores invalid rows', async () => {
        const s = await sleepStateFor({
            sdkRegistry: makeSdk([
                { action_index: 50, resume_block: -1, status: 'invalid' },
                { action_index: 20, resume_block: 900, status: 'valid' },
            ]),
            chainId: 'c', query: 'JDOG', type: 'token',
        });
        expect(s.resumeBlock).toBe(900);
    });

    it('an address query skips the tick pauses that address signed', async () => {
        const rows = [
            { action_index: 60, type: 2, tick: 'JDOG', resume_block: -1, status: 'valid' },
            { action_index: 40, type: 1, tick: null, resume_block: 900, status: 'valid' },
        ];
        const s = await sleepStateFor({ sdkRegistry: makeSdk(rows), chainId: 'c', query: 'addr-1', type: 'address' });
        expect(s.resumeBlock).toBe(900);
        expect(s.actionIndex).toBe(40);
    });

    it('an address that only ever paused a token reads as never slept', async () => {
        const rows = [{ action_index: 60, type: 2, tick: 'JDOG', resume_block: -1, status: 'valid' }];
        const s = await sleepStateFor({ sdkRegistry: makeSdk(rows), chainId: 'c', query: 'addr-1', type: 'address' });
        expect(s.resumeBlock).toBeNull();
    });

    it('falls back to the tick field when a row carries no type', async () => {
        const rows = [
            { action_index: 60, tick: 'JDOG', resume_block: -1, status: 'valid' },
            { action_index: 40, tick: '', resume_block: 900, status: 'valid' },
        ];
        const s = await sleepStateFor({ sdkRegistry: makeSdk(rows), chainId: 'c', query: 'addr-1', type: 'address' });
        expect(s.resumeBlock).toBe(900);
    });
});
