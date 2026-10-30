// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Panic mode armed while a signed send waits in its Undo hold (or while a
// hardware signer waits on the device) must stop the broadcast. The freeze is
// checked once before signing; the bytes leave the wallet only after the hold,
// so the freeze is checked again at that point.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    configurePanicModePersistence,
} from '../../../packages/core/src/flows/panicMode.js';
import { listPendingCommits } from '../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js';

const ENVELOPE = {
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 12345,
    commitAddress: 'bcrt1pexample',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
};

function revealLegs(txid, encoding) {
    const scriptType = encoding === 'P2WSH' ? 'p2wsh' : 'p2sh';
    return {
        inputs: [{ prevTxHash: txid, prevTxIndex: 0, scriptType, redeemScriptHex: '0100' }],
        outputs: [{ scriptType, scriptPubKeyHex: '6a00', value: 0 }],
    };
}

function harness(encoding) {
    const encoder = {
        createTx: vi.fn(async () => ({
            psbt: 'PHASE1',
            encoding,
            ...(encoding === 'TAPROOT' ? { revealPsbt: 'REVEAL', envelope: ENVELOPE } : {}),
        })),
        broadcastTx: vi.fn(async () => ({})),
        spendP2sh: vi.fn(async () => ({ psbt: 'PHASE2' })),
    };
    const signPsbt = vi.fn(async ({ psbtHex, envelopeReveal }) => {
        const txid = envelopeReveal
            ? 'REVEALTXID'
            : (encoding === 'TAPROOT' ? ENVELOPE.commitTxid : `txid-${psbtHex}`);
        return { signedPsbtHex: `SIGNED(${psbtHex})`, txHex: `TX(${psbtHex})`, txid };
    });
    const args = {
        sdkRegistry: { get: () => ({
            encoder,
            actions: {
                createAction: () => ({ actionString: 'FILE|0|a.txt|text/plain', action: 'FILE', version: 0 }),
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
    return { encoder, signPsbt, args };
}

beforeEach(() => {
    localStorage.clear();
    __resetPanicModePersistenceForTests();
});

afterEach(() => {
    __resetPanicModePersistenceForTests();
    localStorage.clear();
});

describe.each(['OP_RETURN', 'P2SH', 'TAPROOT'])('panic armed during the hold on the %s lane', (encoding) => {
    it('refuses the broadcast and leaves no recovery record', async () => {
        const h = harness(encoding);
        const beforeBroadcast = vi.fn(async () => {
            // Another tab or window arms the freeze while this send is held.
            activatePanicMode();
        });

        await expect(submitWithSigner({ ...h.args, beforeBroadcast }))
            .rejects.toMatchObject({ name: 'PanicModeActiveError' });

        expect(h.signPsbt).toHaveBeenCalled();
        expect(beforeBroadcast).toHaveBeenCalledOnce();
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(listPendingCommits()).toHaveLength(0);
    });

    it('refuses when the freeze reaches this context through the persisted store', async () => {
        // Extension and native shells: the freeze arrives from another context
        // as a store update, not as a call in this one.
        const store = { load: async () => null, save: async () => {}, clear: async () => {} };
        await configurePanicModePersistence(store);
        const h = harness(encoding);
        const { applyExternalPanicModeState } = await import('../../../packages/core/src/flows/panicMode.js');
        const now = Date.now();
        const beforeBroadcast = async () => {
            applyExternalPanicModeState({
                activatedAt: now,
                expiresAt: now + 60 * 60 * 1000,
                durationMs: 60 * 60 * 1000,
                armedBy: 'self',
            });
        };

        await expect(submitWithSigner({ ...h.args, beforeBroadcast }))
            .rejects.toMatchObject({ name: 'PanicModeActiveError' });
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
    });

    it('still broadcasts when no freeze is armed during the hold', async () => {
        const h = harness(encoding);
        await submitWithSigner({ ...h.args, beforeBroadcast: async () => {} });
        expect(h.encoder.broadcastTx).toHaveBeenCalled();
    });
});

describe('submitAction after a late freeze', () => {
    it('records the pending send as failed, never queued for a later broadcast', async () => {
        const h = harness('OP_RETURN');
        const puts = [];
        const vault = {
            settings: { get: vi.fn(async () => ({})) },
            pendingTxs: {
                put: vi.fn(async (record) => { puts.push({ ...record }); }),
                get: vi.fn(async () => null),
                list: vi.fn(async () => []),
            },
        };
        const onBroadcastFailure = vi.fn();

        await expect(submitAction({
            vault,
            walletId: 'wallet-1',
            chainRegistry: { get: () => ({}) },
            sdkRegistry: h.args.sdkRegistry,
            chainId: 'BTC',
            actionData: h.args.actionData,
            encoderOpts: h.args.encoderOpts,
            prebuiltPsbt: { psbtHex: 'PHASE1', encoding: 'OP_RETURN', actionString: 'SEND|0|DEST|TICK|1' },
            signingPaths: h.args.signingPaths,
            signer: h.args.signer,
            onBroadcastFailure,
            beforeBroadcast: async () => { activatePanicMode(); },
        })).rejects.toMatchObject({ name: 'PanicModeActiveError' });

        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(onBroadcastFailure).not.toHaveBeenCalled();
        expect(puts.some((record) => record.status === 'queued')).toBe(false);
        expect(puts.some((record) => typeof record.txHex === 'string' && record.status !== 'failed')).toBe(false);
    });
});
