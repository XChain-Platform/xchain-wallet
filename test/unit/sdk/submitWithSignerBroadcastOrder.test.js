// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the durable record of a broadcast precedes the broadcast.
//
// submitAction tracks the PendingTx lifecycle through the onProgress callback it
// hands to submitWithSigner: the 'broadcasting' phase is where it durably puts
// `status: 'broadcasting'` with the txid. That callback is async, and it used to
// be fired and forgotten one line above `broadcastTx`, so the network could accept
// a transaction while the durable row still said 'awaiting-signature' - and a crash
// in that window left a record claiming nothing had ever been sent.
//
// These pin ORDER, and the fail-closed half: a record that cannot be written must
// stop the send, exactly as recordPendingCommit already does for the envelope
// commit. Nothing here asserts what the auto-pay watcher then does with that row.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

function harness({ progressDelayMs = 0, progressThrows = false } = {}) {
    const trace = [];
    const encoder = {
        createTx: vi.fn(async () => ({ psbt: '70736274ff', encoding: 'TAPROOT' })),
        broadcastTx: vi.fn(async () => { trace.push('broadcast'); return {}; }),
        spendP2sh: vi.fn(async () => ({ psbt: '70736274ff' })),
    };
    const sdkRegistry = {
        get: () => ({
            encoder,
            actions: { createAction: () => ({ actionString: 'FILE|0|a.txt|text/plain', action: 'FILE', version: 0 }) },
        }),
    };
    // Stands in for submitAction's composedOnProgress: async, and the durable put
    // only lands after an await - which is precisely why firing it unawaited raced.
    const onProgress = vi.fn(async (phase) => {
        if (phase !== 'broadcasting') return;
        if (progressDelayMs) await new Promise(r => setTimeout(r, progressDelayMs));
        if (progressThrows) { trace.push('durable-write-failed'); throw new Error('vault write failed'); }
        trace.push('durable-broadcasting');
    });
    return { sdkRegistry, encoder, onProgress, trace };
}

const call = (h) => submitWithSigner({
    sdkRegistry: h.sdkRegistry,
    chainId: 'BTC',
    chainRegistry: { get: () => ({}) },
    actionData: { action: 'FILE', params: {} },
    encoderOpts: { pubkey: '03abc', rawData: 'x' },
    signer: { signPsbt: vi.fn(async () => ({ txHex: 'signed-hex', txid: 'TXID' })) },
    signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/3" }],
    onProgress: h.onProgress,
});

describe('submitWithSigner durably records the broadcast before making it', () => {

    it('waits for the broadcasting progress write, even when it awaits', async () => {
        const h = harness({ progressDelayMs: 5 });
        await call(h);
        expect(h.trace).toEqual(['durable-broadcasting', 'broadcast']);
    });

    it('a durable write that fails stops the send (no money moves unrecorded)', async () => {
        const h = harness({ progressThrows: true });
        await expect(call(h)).rejects.toThrow(/vault write failed/);
        expect(h.encoder.broadcastTx).not.toHaveBeenCalled();
        expect(h.trace).toEqual(['durable-write-failed']);
    });

    it('a synchronous onProgress (the default caller shape) still broadcasts', async () => {
        const h = harness();
        h.onProgress = (phase) => { if (phase === 'broadcasting') h.trace.push('sync-progress'); };
        await call(h);
        expect(h.trace).toEqual(['sync-progress', 'broadcast']);
    });
});
