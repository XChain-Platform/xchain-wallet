// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the transparent-compression report survives the prebuilt lane (#38).
//
// The encoder silently deflates a FILE payload, so the bytes the user pays to
// store can be a fraction of the file they picked. `PublishFileForm` is written
// to tell them so, from `result.compression`, and the code comments say there
// is no other way for them to find that number out.
//
// The live-encode branch carried the report because it reads the encoder's own
// result. The prebuilt branch rebuilt `encoded` from the envelope by hand and
// listed only psbt and encoding, and the result builder sets `compression` only
// when `encoded.compression` exists, so the field simply vanished. Since every
// non-watcher publish now goes through the confirm lane, that was the only lane
// a real user could take: `storedSizeSummary(undefined, n)` returns null by
// design and the success screen showed nothing at all.
//
// These tests pin the envelope contract on BOTH branches, because a fix on one
// is exactly how the two drifted apart in the first place.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

// A report shaped like the encoder's: it rewrites the COMPRESSION field and
// reports what it actually wrote.
const REPORT = { compressed: true, data: 'FILE|0|a.json|application/json|||||||1', rawData: 'deflated-bytes' };

function harness({ compression } = {}) {
    const encoder = {
        createTx: vi.fn(async () => ({
            psbt: '70736274ff',
            encoding: 'P2WSH',
            ...(compression ? { compression } : {}),
        })),
        broadcastTx: vi.fn(async () => ({})),
        spendP2sh: vi.fn(async () => ({ psbt: '70736274ff' })),
    };
    const sdkRegistry = {
        get: () => ({
            encoder,
            actions: {
                createAction: () => ({
                    actionString: 'FILE|0|a.json|application/json',
                    action: 'FILE',
                    version: 0,
                }),
            },
        }),
    };
    const signPsbt = vi.fn(async () => ({ txHex: 'signed-hex', txid: 'TXID' }));
    return { sdkRegistry, signPsbt, encoder };
}

const submit = ({ sdkRegistry, signPsbt }, prebuiltPsbt) => submitWithSigner({
    sdkRegistry,
    chainId: 'BTC',
    chainRegistry: { get: () => ({}) },
    actionData: { action: 'FILE', params: {} },
    encoderOpts: { pubkey: '03abc', rawData: 'x' },
    // `kind: software` is what signerCapability allows onto the P2WSH
    // chunk lane, and it is the lane a real Publish file takes.
    signer: { signPsbt, kind: 'software' },
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
    ...(prebuiltPsbt ? { prebuiltPsbt } : {}),
});

const envelope = (extra = {}) => ({
    psbtHex: '70736274ff',
    encoding: 'P2WSH',
    actionString: 'FILE|0|a.json|application/json',
    version: 0,
    ...extra,
});

describe('compression report on the prebuilt lane (#38)', () => {
    it('carries the report the confirm lane approved through to the result', async () => {
        const h = harness();
        const result = await submit(h, envelope({ compression: REPORT }));
        expect(result.compression).toEqual(REPORT);
    });

    it('does not invent a report when compose produced none', async () => {
        // storedSizeSummary treats a missing report as "nothing trustworthy to
        // say" and renders nothing, which is the correct outcome here. An empty
        // object would instead be a claim about a size nobody measured.
        const h = harness();
        const result = await submit(h, envelope());
        expect(result.compression).toBeUndefined();
    });

    it('never calls the encoder on this lane, so the report can only come from the envelope', async () => {
        const h = harness({ compression: REPORT });
        const result = await submit(h, envelope());
        expect(h.encoder.createTx).not.toHaveBeenCalled();
        // The encoder's own report must NOT leak in: these bytes were built by
        // compose, and a report from a fresh encode would describe different ones.
        expect(result.compression).toBeUndefined();
    });
});

describe('compression report on the live-encode lane', () => {
    it('still reaches the result, unchanged by the prebuilt fix', async () => {
        const h = harness({ compression: REPORT });
        const result = await submit(h);
        expect(result.compression).toEqual(REPORT);
    });

    it('is absent when the encoder did not compress', async () => {
        const h = harness();
        const result = await submit(h);
        expect(result.compression).toBeUndefined();
    });
});
