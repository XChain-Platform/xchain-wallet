// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { sendToken } from '../../../packages/core/src/flows/sendToken.js';
import { listPendingCommits } from '../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';

const ENVELOPE = {
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 12345,
    commitAddress: 'bcrt1pexample',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
};

const revealLegs = (txid, encoding) => {
    const scriptType = encoding === 'P2WSH' ? 'p2wsh' : 'p2sh';
    const script = {
        [scriptType === 'p2wsh' ? 'witnessScriptHex' : 'redeemScriptHex']: '0100',
    };
    return {
        inputs: [{ prevTxHash: txid, prevTxIndex: 0, scriptType, ...script }],
        outputs: [{ scriptType }],
    };
};

function harness(encoding) {
    const trace = [];
    const encoder = {
        createTx: vi.fn(async () => ({
            psbt: 'PHASE1',
            encoding,
            ...(encoding === 'TAPROOT' ? { revealPsbt: 'REVEAL', envelope: ENVELOPE } : {}),
        })),
        broadcastTx: vi.fn(async () => { trace.push('broadcast'); return {}; }),
        spendP2sh: vi.fn(async () => ({ psbt: 'PHASE2' })),
    };
    const signPsbt = vi.fn(async ({ psbtHex, envelopeReveal }) => {
        trace.push(envelopeReveal ? 'signReveal' : `sign:${psbtHex}`);
        const txid = envelopeReveal
            ? 'REVEALTXID'
            : (encoding === 'TAPROOT' ? ENVELOPE.commitTxid : `txid-${psbtHex}`);
        return { signedPsbtHex: `SIGNED(${psbtHex})`, txHex: `TX(${psbtHex})`, txid };
    });
    const args = {
        sdkRegistry: { get: () => ({
            encoder,
            actions: {
                createAction: () => ({
                    actionString: 'FILE|0|a.txt|text/plain',
                    action: 'FILE',
                    version: 0,
                }),
            },
            wallet: { decomposePsbt: () => revealLegs('txid-PHASE1', encoding) },
        }) },
        chainId: 'BTC',
        chainRegistry: { get: () => ({ id: 'BTC', coin: 'bitcoin' }) },
        actionData: { action: 'FILE', params: {} },
        encoderOpts: { pubkey: '03abc', rawData: 'x' },
        signer: { kind: 'software', signPsbt },
        signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/3" }],
    };
    return { trace, encoder, signPsbt, args };
}

describe.each(['OP_RETURN', 'P2SH', 'TAPROOT'])('beforeBroadcast hold on the %s lane', (encoding) => {
    beforeEach(() => { localStorage.clear(); });

    it('hands the hook signed bytes before any broadcast and waits for it', async () => {
        const h = harness(encoding);
        let release;
        const blocked = new Promise((resolve) => { release = resolve; });
        const hook = vi.fn(async (held) => {
            h.trace.push('hold');
            expect(held.signed).toMatchObject({
                signedPsbtHex: 'SIGNED(PHASE1)',
                txHex: 'TX(PHASE1)',
            });
            if (encoding === 'TAPROOT') {
                expect(held.revealSigned).toMatchObject({
                    signedPsbtHex: 'SIGNED(REVEAL)',
                    txHex: 'TX(REVEAL)',
                });
            } else {
                expect(held.revealSigned).toBeNull();
            }
            expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
            await blocked;
        });

        const submitted = submitWithSigner({ ...h.args, beforeBroadcast: hook });
        await vi.waitFor(() => expect(hook).toHaveBeenCalledOnce());
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
        release();
        await submitted;

        const firstBroadcast = h.trace.indexOf('broadcast');
        expect(h.trace.indexOf('hold')).toBeGreaterThan(h.trace.indexOf('sign:PHASE1'));
        if (encoding === 'TAPROOT') {
            expect(h.trace.indexOf('hold')).toBeGreaterThan(h.trace.indexOf('signReveal'));
        }
        expect(h.trace.indexOf('hold')).toBeLessThan(firstBroadcast);
    });

    it('a rejecting hook broadcasts nothing and leaves no TAPROOT recovery record', async () => {
        const h = harness(encoding);
        const cancel = Object.assign(new Error('cancelled'), { name: 'SendHoldCancelledError' });

        await expect(submitWithSigner({
            ...h.args,
            beforeBroadcast: async () => { throw cancel; },
        })).rejects.toMatchObject({ name: 'SendHoldCancelledError' });

        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(h.encoder.spendP2sh).not.toHaveBeenCalled();
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('without the option the send broadcasts exactly as before', async () => {
        const h = harness(encoding);
        await submitWithSigner(h.args);
        expect(h.encoder.broadcastTx).toHaveBeenCalled();
    });
});

describe('beforeBroadcast flow pass-through', () => {
    const cancel = () => Object.assign(new Error('cancelled'), { name: 'SendHoldCancelledError' });
    const vault = { settings: { get: vi.fn(async () => ({})) } };
    const chainRegistry = { get: () => ({}) };
    const prebuiltPsbt = {
        psbtHex: 'PHASE1',
        encoding: 'OP_RETURN',
        actionString: 'SEND|0|DEST|TICK|1',
    };

    it('submitAction forwards the hook to the SDK boundary', async () => {
        const h = harness('OP_RETURN');
        const beforeBroadcast = vi.fn(async () => { throw cancel(); });

        await expect(submitAction({
            vault,
            walletId: 'wallet-1',
            chainRegistry,
            sdkRegistry: h.args.sdkRegistry,
            chainId: 'BTC',
            actionData: h.args.actionData,
            encoderOpts: h.args.encoderOpts,
            prebuiltPsbt,
            signingPaths: h.args.signingPaths,
            signer: h.args.signer,
            beforeBroadcast,
        })).rejects.toMatchObject({ name: 'SendHoldCancelledError' });

        expect(beforeBroadcast).toHaveBeenCalledOnce();
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
    });

    it('sendToken forwards the hook through submitAction', async () => {
        const h = harness('OP_RETURN');
        const beforeBroadcast = vi.fn(async () => { throw cancel(); });

        await expect(sendToken({
            vault,
            walletId: 'wallet-1',
            chainRegistry,
            sdkRegistry: h.args.sdkRegistry,
            chainId: 'BTC',
            from: {
                address: 'SOURCE',
                publicKey: '03abc',
                derivationPath: "m/86'/0'/0'/0/3",
            },
            to: 'DEST',
            tick: 'TICK',
            amount: '1',
            prebuiltPsbt,
            signer: h.args.signer,
            trackPendingTx: false,
            beforeBroadcast,
        })).rejects.toMatchObject({ name: 'SendHoldCancelledError' });

        expect(beforeBroadcast).toHaveBeenCalledOnce();
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
    });
});
