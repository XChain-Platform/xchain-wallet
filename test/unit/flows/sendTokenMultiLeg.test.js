// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-52 at the flow boundary: what sendToken and buildSendPsbt actually hand
// the SDK when the caller passes `legs`.
//
// sendLegs.test.js pins the shaping in isolation; this file pins the wiring,
// which is where the two refusals have to bite (a native or gated multi-send
// must never reach the encoder) and where the single-recipient path must stay
// exactly as it was, gated guard and native output included.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/gatedSendGuard.js', () => ({
    prepareGatedSend: vi.fn(async () => null),
    getGatedGroupsForSend: vi.fn(async () => []),
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'send-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { prepareGatedSend, getGatedGroupsForSend } from '../../../packages/core/src/flows/gatedSendGuard.js';
import { sendToken } from '../../../packages/core/src/flows/sendToken.js';
import { buildSendPsbt } from '../../../packages/core/src/flows/buildSendPsbt.js';

const FROM = { address: 'bcrt1qsender', publicKey: '03dd4688', derivationPath: "m/84'/1'/0'/0/0" };
const A = 'bcrt1qalice';
const B = 'bcrt1qbob';

// isValidAddressForChain only runs when the descriptor names a coin + network;
// these fixture addresses are not real base58/bech32, so the descriptor here
// deliberately carries only `coin` (which is what the native-tick check reads).
function opts(extra = {}) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => ({}) },
        chainId: 'bitcoin-regtest',
        from: FROM,
        ...extra,
    };
}

describe('sendToken with legs', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
        vi.mocked(prepareGatedSend).mockClear();
        vi.mocked(getGatedGroupsForSend).mockClear();
    });

    function actionData() {
        return vi.mocked(submitAction).mock.calls[0][0].actionData;
    }

    it('[REGRESSION] a flat single send still emits flat params and no LEGS', async () => {
        await sendToken(opts({ to: A, tick: 'PEPE', amount: '5', memo: 'hi' }));
        expect(actionData()).toEqual({
            action: 'SEND',
            params: { TICK: 'PEPE', AMOUNT: '5', DESTINATION: A, MEMO: 'hi' },
        });
    });

    it('[REGRESSION] a single send still runs the gated guard', async () => {
        await sendToken(opts({ to: A, tick: 'PEPE', amount: '5' }));
        expect(prepareGatedSend).toHaveBeenCalledTimes(1);
    });

    it('passes a two-recipient send through as LEGS with the tick hoisted', async () => {
        await sendToken(opts({
            tick: 'PEPE',
            legs: [{ to: A, amount: '7' }, { to: B, amount: '3' }],
        }));
        expect(actionData().params).toEqual({
            TICK: 'PEPE',
            LEGS: [{ AMOUNT: '7', DESTINATION: A }, { AMOUNT: '3', DESTINATION: B }],
        });
    });

    it('summarizes a multi-recipient send by per-tick total, not by first recipient', async () => {
        await sendToken(opts({
            tick: 'PEPE',
            legs: [{ to: A, amount: '7' }, { to: B, amount: '3' }],
        }));
        const { pendingTxMeta } = vi.mocked(submitAction).mock.calls[0][0];
        expect(pendingTxMeta.actionSummary).toBe('Send 10 PEPE to 2 recipients');
    });

    it('swaps the single-recipient gated guard for the multi-leg gated refusal', async () => {
        await sendToken(opts({
            sdkRegistry: { get: () => ({ gatedFile: {}, messaging: {} }) },
            tick: 'PEPE',
            legs: [{ to: A, amount: '7' }, { to: B, amount: '3' }],
        }));
        expect(prepareGatedSend).not.toHaveBeenCalled();
        expect(getGatedGroupsForSend).toHaveBeenCalled();
    });

    it('refuses a multi-recipient native send before it reaches the encoder', async () => {
        await expect(sendToken(opts({
            tick: 'BTC',
            legs: [{ to: A, amount: '1' }, { to: B, amount: '2' }],
        }))).rejects.toThrow(/BTC cannot be sent to several recipients/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('refuses a multi-recipient send of a gated tick before it reaches the encoder', async () => {
        vi.mocked(getGatedGroupsForSend).mockResolvedValueOnce([{ keyHash: 'aa', files: [{}] }]);
        await expect(sendToken(opts({
            sdkRegistry: { get: () => ({ gatedFile: {}, messaging: {} }) },
            tick: 'GATED',
            legs: [{ to: A, amount: '1' }, { to: B, amount: '2' }],
        }))).rejects.toThrow(/GATED has token-gated content/);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('[REGRESSION] a single native send still appends the destination payment output', async () => {
        await sendToken(opts({ to: A, tick: 'BTC', amount: '1' }));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.customOutputs).toEqual([{ address: A, value: '100000000' }]);
    });

    it('adds no native output to a multi-recipient token send', async () => {
        await sendToken(opts({
            tick: 'PEPE',
            legs: [{ to: A, amount: '7' }, { to: B, amount: '3' }],
        }));
        const { encoderOpts } = vi.mocked(submitAction).mock.calls[0][0];
        expect(encoderOpts.customOutputs).toBeUndefined();
    });

    it('validates every destination, not just the first', async () => {
        await expect(sendToken(opts({
            chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
            tick: 'PEPE',
            legs: [{ to: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', amount: '7' }, { to: 'not-an-address', amount: '3' }],
        }))).rejects.toThrow(/not a valid bitcoin regtest address/);
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe('buildSendPsbt with legs (watcher parity)', () => {
    function watcherOpts(extra = {}) {
        const encoder = { createTx: vi.fn(async () => ({ psbt: '70736274ff', encoding: 'P2SH' })) };
        const sdk = {
            encoder,
            actions: { createAction: vi.fn(() => ({ actionString: 'SEND|1|…', action: 'SEND', version: 1 })) },
        };
        return {
            encoder,
            sdk,
            opts: {
                chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
                sdkRegistry: { get: () => sdk },
                chainId: 'bitcoin-regtest',
                from: FROM,
                ...extra,
            },
        };
    }

    beforeEach(() => {
        vi.mocked(prepareGatedSend).mockClear();
        vi.mocked(getGatedGroupsForSend).mockClear();
    });

    it('composes a multi-recipient action for a watch-only wallet to export', async () => {
        const { sdk, opts: o } = watcherOpts({
            tick: 'PEPE',
            legs: [{ to: A, amount: '7' }, { to: B, amount: '3' }],
        });
        const res = await buildSendPsbt(o);
        expect(sdk.actions.createAction).toHaveBeenCalledWith({
            action: 'SEND',
            params: { TICK: 'PEPE', LEGS: [{ AMOUNT: '7', DESTINATION: A }, { AMOUNT: '3', DESTINATION: B }] },
        });
        expect(res.psbtHex).toBe('70736274ff');
    });

    it('makes the same native refusal as sendToken, so the two paths cannot disagree', async () => {
        const { encoder, opts: o } = watcherOpts({
            tick: 'BTC',
            legs: [{ to: A, amount: '1' }, { to: B, amount: '2' }],
        });
        await expect(buildSendPsbt(o)).rejects.toThrow(/BTC cannot be sent to several recipients/);
        expect(encoder.createTx).not.toHaveBeenCalled();
    });
});
