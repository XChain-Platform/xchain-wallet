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
// Stand-in for the deflated payload the encoder reports back: 300 stored bytes
// out of the 2048 the wallet handed over.
const STORED_300 = 'z'.repeat(300);

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

describe('the composed action string is the one the PSBT carries', () => {

    // The encoder rewrites the COMPRESSION field and deflates the payload
    // inside create_tx, and now reports BOTH halves of what it wrote. The wallet
    // states that string (so a compressible FILE stops refusing itself) and
    // carries those bytes to the reveal (so the reveal can still reproduce the
    // commit's carrier, which is what made a local re-derive unsafe).
    it('states the string the encoder actually wrote', async () => {
        const h = makeHarness({
            compression: {
                compressed: true, rawLength: 2048, storedLength: 300, reason: null,
                data: FILE_ACTION_COMPRESSED, rawData: STORED_300,
            },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.actionString).toBe(FILE_ACTION_COMPRESSED);
        // ...and the allowance is still sized off the STORED payload, not the
        // bytes the wallet handed over, so compression tightens the bound. That
        // is the #7200 half, which stands on its own.
        expect(composed.expectedOutputs.carrierAllowance)
            .toBe(allowanceFor(FILE_ACTION_COMPRESSED.length + 1 + 300 + 2));
    });

    it('hands the reveal the STORED bytes, not the ones the wallet supplied', async () => {
        // The whole reason the substitution above is safe: submitWithSigner
        // builds phase 2 from revealOpts.rawData, and the reveal re-derives its
        // carrier chunks from script.compile([actionString, rawData]). Given the
        // uncompressed payload under a compressed marker it compiles a carrier
        // that hashes to nothing the commit created, and the commit - already
        // broadcast - can never be spent.
        const h = makeHarness({
            compression: {
                compressed: true, rawLength: 2048, storedLength: 300, reason: null,
                data: FILE_ACTION_COMPRESSED, rawData: STORED_300,
            },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.revealOpts.rawData).toBe(STORED_300);
        expect(composed.revealOpts.rawData).not.toBe(h.args.encoderOpts.rawData);
    });

    it('REFUSES when the encoder says it compressed but withholds what it wrote', async () => {
        // An encoder too old to report the written bytes cannot be described or
        // revealed against. A pre-broadcast refusal is recoverable; a broadcast
        // commit nothing can spend is not.
        const h = makeHarness({
            compression: { compressed: true, rawLength: 2048, storedLength: 300, reason: null },
        });
        await expect(composeForConfirm(h.args)).rejects.toThrow(/does not match what you approved/);
    });

    it('REFUSES a written string that is not the wallet\'s own with only COMPRESSION set', async () => {
        // The encoder is the artifact the confirm check polices, so "here is what
        // I wrote" is verified, not adopted: a substituted NAME rides in on the
        // same field the compression pass legitimately rewrites.
        const h = makeHarness({
            compression: {
                compressed: true, rawLength: 2048, storedLength: 300, reason: null,
                data: 'FILE|0|payload.exe|text/plain|||||||1', rawData: STORED_300,
            },
        });
        await expect(composeForConfirm(h.args)).rejects.toThrow(/does not match what you approved/);
    });

    it('REFUSES a stored payload larger than the bytes handed over', async () => {
        const h = makeHarness({
            rawData: 'x'.repeat(100),
            compression: {
                compressed: true, rawLength: 100, storedLength: 200, reason: null,
                data: FILE_ACTION_COMPRESSED, rawData: 'z'.repeat(200),
            },
        });
        await expect(composeForConfirm(h.args)).rejects.toThrow(/does not match what you approved/);
    });

    it('REFUSES an unknown codec rather than adopting the marker it cannot read', async () => {
        const h = makeHarness({
            compression: {
                compressed: true, rawLength: 2048, storedLength: 300, reason: null,
                data: 'FILE|0|sample.txt|text/plain|||||||9', rawData: STORED_300,
            },
        });
        await expect(composeForConfirm(h.args)).rejects.toThrow(/does not match what you approved/);
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

    it('ADMITS a compressible FILE upload end to end, against the bytes the PSBT carries', async () => {
        // The decisive end-to-end shape, and the defect this item closes: the
        // PSBT decodes to the string the ENCODER wrote, and the wallet now
        // states that same string, so the tamper check passes instead of
        // refusing a transaction the wallet itself asked for. Driven through the
        // whole confirm envelope, not asserted on composeForConfirm's return.
        const h = makeHarness({
            encoding: 'OP_RETURN',
            rawData: 'x'.repeat(40),
            compression: {
                compressed: true, rawLength: 40, storedLength: 20, reason: null,
                data: FILE_ACTION_COMPRESSED, rawData: 'z'.repeat(20),
            },
        });
        const sdk = h.args.sdkRegistry.get();
        // What decoding the built PSBT really yields on the inline lane.
        sdk.decoder.decodeActionStringFromPsbt = vi.fn(() => ({
            ok: true, actionString: FILE_ACTION_COMPRESSED,
        }));
        const envelope = await composeActionForConfirm({
            vault: h.args.vault,
            chainRegistry: h.args.chainRegistry,
            sdkRegistry: h.args.sdkRegistry,
            chainId: h.args.chainId,
            actionData: h.args.actionData,
            encoderOpts: h.args.encoderOpts,
            source: SPENDER,
            ownAddresses: [SPENDER],
        });
        expect(envelope.actionString).toBe(FILE_ACTION_COMPRESSED);
    });

    it('still refuses when the PSBT carries a string the encoder did not report', async () => {
        // The gate has not been loosened, only pointed at the right string: an
        // action string in the transaction that the compression report does not
        // account for is still tamper.
        const h = makeHarness({
            encoding: 'OP_RETURN',
            rawData: 'x'.repeat(40),
            compression: {
                compressed: true, rawLength: 40, storedLength: 20, reason: null,
                data: FILE_ACTION_COMPRESSED, rawData: 'z'.repeat(20),
            },
        });
        const sdk = h.args.sdkRegistry.get();
        sdk.decoder.decodeActionStringFromPsbt = vi.fn(() => ({
            ok: true, actionString: 'FILE|0|payload.exe|text/plain|||||||1',
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
        // carriers. Here the written bytes are honest and only the LENGTH lies.
        const h = makeHarness({
            rawData: 'x'.repeat(100),
            compression: {
                compressed: true, rawLength: 100, storedLength: 9_000_000, reason: null,
                data: FILE_ACTION_COMPRESSED, rawData: 'z'.repeat(60),
            },
        });
        const composed = await composeForConfirm(h.args);
        expect(composed.expectedOutputs.carrierAllowance)
            .toBe(allowanceFor(FILE_ACTION_COMPRESSED.length + 1 + 60 + 2));
    });
});
