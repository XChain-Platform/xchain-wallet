// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two ways the confirm pipeline described a transaction it had just asked for,
// and then refused it as tampered:
//
//   1. the carrier allowance was sized off the ACTION string alone, while the
//      encoder chunks script.compile([actionString, rawData]) - so a couple of
//      KB of file bytes needed five carriers against an allowance of two, and
//      the surplus three were reported as outputs the user never approved;
//   2. transparent FILE compression is ON by deployment default and rewrites
//      the action string's COMPRESSION field in place, reporting only a
//      boolean - so the wallet compared its pre-compression string against
//      post-compression bytes and failed its own byte / carrier-script check.
//
// Both are the payload-carrying classes: FILE upload, artwork/TIS attach,
// gated publish, label sync.

import { describe, it, expect, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';

const SPENDER = 'bcrt1qspender';
const FILE_ACTION = 'FILE|0|sample.txt|text/plain';
// The same string once the encoder's transparent compression has set the
// COMPRESSION field: it is the TENTH field, so every optional field before it
// re-materializes as an empty separator.
const FILE_ACTION_COMPRESSED = 'FILE|0|sample.txt|text/plain|||||||1';

function makeHarness({ encoding = 'P2SH', rawData = 'x'.repeat(2048), compression = undefined } = {}) {
    const createTx = vi.fn(async () => ({
        psbt: 'PSBTHEX',
        encoding,
        carrierScripts: ['aa11'],
        ...(compression ? { compression } : {}),
    }));
    const sdk = {
        encoder: { createTx },
        actions: {
            createAction: vi.fn(() => ({ actionString: FILE_ACTION, action: 'FILE', version: 0 })),
        },
        wallet: {
            decomposePsbt: vi.fn(() => ({ inputs: [{ value: 5000 }], outputs: [] })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: 'ignored' })),
            describe: vi.fn(() => ({ summary: 'file', details: [], warnings: [] })),
            verifyCarrierScripts: vi.fn(() => ({ ok: true })),
        },
    };
    return {
        createTx,
        args: {
            sdkRegistry: { get: () => sdk },
            chainRegistry: {
                get: () => ({
                    coin: 'LTC',
                    networkKind: 'regtest',
                    adsDonationAddress: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
                }),
            },
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainId: 'litecoin-regtest',
            actionData: { action: 'FILE', params: { NAME: 'sample.txt', TYPE: 'text/plain' } },
            encoderOpts: { pubkey: 'pub', rawData },
            source: SPENDER,
        },
    };
}

// The allowance formula, restated here so the expectation is arithmetic rather
// than a copied constant: ceil((compiled + 16) / 476) + 1 on the P2SH lane.
function allowanceFor(compiledBytes) {
    return Math.ceil((compiledBytes + 16) / 476) + 1;
}

describe('carrier allowance counts the whole compiled payload', () => {

    it('admits every carrier a 2 KB FILE payload legitimately needs', async () => {
        const h = makeHarness();
        const composed = await composeForConfirm(h.args);
        // compile([action, raw]) = 28 + 1 prefix + 2048 + 3 prefix = 2080.
        const compiled = 28 + 1 + 2048 + 3;
        expect(composed.expectedOutputs.carrierAllowance).toBe(allowanceFor(compiled));
        // The encoder emits ceil(2080 / 476) = 5 carriers for these bytes, and
        // sizing off the 28-byte action alone allowed 2 (the pre-fix number).
        expect(composed.expectedOutputs.carrierAllowance)
            .toBeGreaterThanOrEqual(Math.ceil(compiled / 476));
    });

    it('stays at a single carrier on the OP_RETURN lane', async () => {
        const h = makeHarness({ encoding: 'OP_RETURN', rawData: 'x'.repeat(40) });
        const composed = await composeForConfirm(h.args);
        expect(composed.expectedOutputs.carrierAllowance).toBe(1);
    });

    it('counts a Latin-1 payload one byte per character, not per UTF-8 byte', async () => {
        // Every character is >= 0x80, which a UTF-8 count would double. Doubling
        // OVER-allows, so the tamper gate would quietly loosen for exactly the
        // binary payloads (gated ciphertext, deflate output) that carry them.
        const raw = 'ÿ'.repeat(1000);
        const ascii = 'x'.repeat(1000);
        const hiBits = await composeForConfirm(makeHarness({ rawData: raw }).args);
        const plain = await composeForConfirm(makeHarness({ rawData: ascii }).args);
        expect(hiBits.expectedOutputs.carrierAllowance)
            .toBe(plain.expectedOutputs.carrierAllowance);
        expect(hiBits.expectedOutputs.carrierAllowance).toBe(allowanceFor(28 + 1 + 1000 + 3));
    });

    it('leaves a payload-free action exactly where it was', async () => {
        const h = makeHarness({ rawData: undefined });
        h.args.encoderOpts = { pubkey: 'pub' };
        const composed = await composeForConfirm(h.args);
        expect(composed.expectedOutputs.carrierAllowance).toBe(allowanceFor(28 + 1));
    });
});

describe('the composed action string is the one the WALLET composed', () => {

    // The wallet deliberately reports its PRE-compression string, and a
    // compressible FILE upload is therefore REFUSED at the confirm check rather
    // than broadcast. That refusal is the safe half of the trade: substituting
    // a locally re-derived post-compression string turns the refusal into a
    // broadcast commit whose reveal cannot reproduce the commit's bytes, which
    // strands user funds.
    it('keeps the pre-compression string even when the encoder reports it compressed', async () => {
        const h = makeHarness({
            compression: { compressed: true, rawLength: 2048, storedLength: 300, reason: null },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.actionString).toBe(FILE_ACTION);
        // ...and the allowance is still sized off the STORED payload, not the
        // bytes the wallet handed over, so compression tightens the bound. That
        // is the #7200 half, which stands on its own.
        expect(composed.expectedOutputs.carrierAllowance)
            .toBe(allowanceFor(FILE_ACTION.length + 1 + 300 + 2));
    });

    it('leaves the string byte-identical when compression did not fire', async () => {
        const h = makeHarness({
            compression: { compressed: false, rawLength: 2048, storedLength: 2048, reason: 'not-smaller' },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.actionString).toBe(FILE_ACTION);
    });

    it('leaves the string byte-identical against an encoder that reports nothing', async () => {
        const composed = await composeForConfirm(makeHarness().args);
        expect(composed.actionString).toBe(FILE_ACTION);
    });

    it('REFUSES a compressible FILE upload rather than broadcasting an unspendable commit', async () => {
        // The decisive end-to-end shape, and the live defect: the PSBT decodes
        // to the string the ENCODER wrote (compression rewrote COMPRESSION in
        // place and reported only a boolean), while the wallet states the
        // string it composed, so the tamper check refuses.
        //
        // This test pins the REFUSAL on purpose. The obvious repair, having the
        // wallet re-derive the post-compression string locally, is rejected:
        // it makes the confirm check pass and leaves the reveal unable to
        // reproduce the commit's bytes, so the commit broadcasts and the reveal
        // can never spend it. A pre-broadcast refusal is recoverable; a
        // stranded commit is not. The real fix has to make the reveal reproduce
        // those bytes, which lives in xchain-encoder / xchain-sdk.
        const h = makeHarness({
            encoding: 'OP_RETURN',
            rawData: 'x'.repeat(40),
            compression: { compressed: true, rawLength: 40, storedLength: 20, reason: null },
        });
        const sdk = h.args.sdkRegistry.get();
        // What decoding the built PSBT really yields on the inline lane.
        sdk.decoder.decodeActionStringFromPsbt = vi.fn(() => ({
            ok: true, actionString: FILE_ACTION_COMPRESSED,
        }));
        await expect(composeActionForConfirm({
            vault: h.args.vault,
            chainRegistry: h.args.chainRegistry,
            sdkRegistry: h.args.sdkRegistry,
            chainId: h.args.chainId,
            actionData: h.args.actionData,
            encoderOpts: h.args.encoderOpts,
            source: SPENDER,
            ownAddresses: [SPENDER],
        })).rejects.toThrow(/does not match what you approved/);
    });

    it('never lets a reported storedLength widen the allowance beyond the real payload', async () => {
        // The encoder is the artifact this allowance polices, so a report that
        // claims MORE stored bytes than the wallet supplied must not buy extra
        // carriers.
        const h = makeHarness({
            rawData: 'x'.repeat(100),
            compression: { compressed: true, rawLength: 100, storedLength: 9_000_000, reason: null },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.expectedOutputs.carrierAllowance)
            .toBe(allowanceFor(FILE_ACTION_COMPRESSED.length + 1 + 100 + 2));
    });
});
