// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    assertNoTamper, buildExpectedOutputs, TamperDetectedError,
} from '../../../packages/core/src/flows/confirmChecks.js';
import {
    assertNoCredentials, isResumable, resumeAfter, resumeDispatch,
} from '../../../packages/core/src/flows/confirmResume.js';
import {
    classifyBroadcastFailure, isAlreadyOnNetworkRejection,
} from '../../../packages/core/src/flows/broadcastPermanence.js';
import { CpfpPlanError, planCpfpChild } from '../../../packages/core/src/flows/cpfpPlan.js';

const CHAIN = 'bitcoin-mainnet';

function resumable(overrides = {}) {
    return {
        id: 'cs:1:a',
        createdAt: Date.now(),
        request: { walletId: 'w1', chainId: CHAIN, from: { address: 'bc1qsource' } },
        composed: { psbt: '00', chainId: CHAIN },
        dispatch: {
            software: 'sendToken',
            base: { walletId: 'w1', chainId: CHAIN, from: { address: 'bc1qsource' }, params: { tick: 'X' } },
        },
        ...overrides,
    };
}

describe('confirm flow safety audit', () => {
    it('refuses surplus carrier outputs beyond the exact compiled payload count', () => {
        const expected = buildExpectedOutputs({
            customOutputs: [], encoding: 'P2SH', payloadByteLen: 100,
        });
        const checked = (outputs, ownAddresses = []) => assertNoTamper({
            psbtHex: 'psbt',
            expected,
            ownAddresses,
            decomposePsbt: () => ({ outputs }),
            actionString: 'SEND|0|X|1|dest',
            decodeActionFromPsbt: () => ({ ok: true }),
            psbt: 'psbt',
            carrierScripts: ['aa'],
            verifyCarrierScripts: () => ({ ok: true, checked: 1 }),
        });
        const carrier = { address: 'carrier1', scriptPubKeyHex: 'a91411', scriptType: 'p2sh', value: 546 };
        expect(() => checked([
            carrier,
            { address: 'carrier2', scriptPubKeyHex: 'a91422', scriptType: 'p2sh', value: 100000 },
        ])).toThrow(TamperDetectedError);
        expect(() => checked([
            carrier,
            { address: 'own-change', scriptPubKeyHex: 'a91433', scriptType: 'p2sh', value: 100000 },
        ], ['own-change'])).not.toThrow();
    });

    it('rejects nested credentials and cross-scope resume descriptors', () => {
        expect(() => assertNoCredentials({ nested: { password: 'secret' } })).toThrow(/password/);

        const wrongNetwork = resumable();
        wrongNetwork.dispatch = {
            ...wrongNetwork.dispatch,
            base: { ...wrongNetwork.dispatch.base, chainId: 'litecoin-mainnet' },
        };
        expect(isResumable(wrongNetwork, Date.now())).toBe(false);

        const wrongWallet = resumable();
        wrongWallet.dispatch = {
            ...wrongWallet.dispatch,
            base: { ...wrongWallet.dispatch.base, walletId: 'w2' },
        };
        expect(isResumable(wrongWallet, Date.now())).toBe(false);
    });

    it('deep-clones dispatch input and skips a half-written follow-up without a txid', () => {
        const stored = resumable();
        const { base } = resumeDispatch(stored);
        base.params.tick = 'MUTATED';
        expect(stored.dispatch.base.params.tick).toBe('X');

        stored.dispatch.after = {
            method: 'savePendingAirdrop',
            base: { record: { listTxid: '' } },
            txidPath: ['record', 'listTxid'],
        };
        expect(resumeAfter(stored, '')).toBeNull();
        expect(resumeAfter(stored, 'abc').body.record.listTxid).toBe('abc');
    });

    it('treats an already-confirmed rebroadcast as delivery and never throws on cyclic causes', () => {
        const delivered = new Error('Transaction already in block chain');
        expect(isAlreadyOnNetworkRejection(delivered)).toBe(true);
        expect(classifyBroadcastFailure(delivered)).toBe('permanent');

        const cyclic = { message: 'wrapper' };
        cyclic.cause = cyclic;
        cyclic.response = { data: { error: { message: 'bad-txns-inputs-missingorspent' } } };
        expect(classifyBroadcastFailure(cyclic)).toBe('permanent');
    });

    it('rejects a CPFP rate whose computed fee is not an exact safe integer', () => {
        const source = 'bcrt1qsource';
        const parent = {
            inputs: [{ value: '100000000000000000000' }],
            outputs: [{
                address: source,
                value: '99999999999999999000',
                scriptPubKeyHex: `0014${'11'.repeat(20)}`,
            }],
        };
        expect(() => planCpfpChild({
            parentTxid: 'aa'.repeat(32),
            parent,
            sourceAddress: source,
            feeRate: Number.MAX_SAFE_INTEGER,
            parentVbytes: 200,
        })).toThrow(CpfpPlanError);
        expect(() => planCpfpChild({
            parentTxid: 'aa'.repeat(32),
            parent,
            sourceAddress: source,
            feeRate: Number.MAX_SAFE_INTEGER,
            parentVbytes: 200,
        })).toThrow(/inexact satoshi amount/);
    });
});
