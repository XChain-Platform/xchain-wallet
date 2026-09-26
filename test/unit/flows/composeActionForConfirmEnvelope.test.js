// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm lane's checks on a Taproot envelope. One Approve signs the commit
// AND its reveal, so the reveal is held to the commit's standard: it spends the
// commit's envelope output, pays only this wallet, and carries exactly the
// approved action. The confirm screen states both transactions' fees.

import { describe, it, expect, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';
import { checkEnvelopeReveal, envelopeNetworkFees } from '../../../packages/core/src/flows/envelopeRevealCheck.js';
import { envelopeTransactionLines } from '../../../packages/core/src/flows/envelopeFeeDisclosure.js';

const ACTION = 'FILE|0|big.bin|application/octet-stream|Taproot test||';
const SOURCE = 'bcrt1qsource';
const PUBKEY = `02${'11'.repeat(32)}`;
const COMMIT_SCRIPT = `5120${'ee'.repeat(32)}`;
const ENVELOPE = Object.freeze({
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 60000,
    commitAddress: 'bcrt1pcommit',
    internalPubkey: 'bb'.repeat(32),
    tapleafHash: 'cc'.repeat(32),
});

// The commit: one wallet input, the envelope output, change back to the source.
const COMMIT = Object.freeze({
    inputs: [{ prevTxHash: 'ff'.repeat(32), prevTxIndex: 1, value: 100000, scriptPubKeyHex: '0014', address: SOURCE }],
    outputs: [
        { address: ENVELOPE.commitAddress, scriptPubKeyHex: COMMIT_SCRIPT, scriptType: 'p2tr', value: ENVELOPE.commitValue },
        { address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 39000 },
    ],
});

// The reveal: spends the envelope output, returns the dust-floor change.
function revealOf(overrides = {}) {
    return {
        inputs: [{
            prevTxHash: ENVELOPE.commitTxid,
            prevTxIndex: ENVELOPE.commitVout,
            value: ENVELOPE.commitValue,
            scriptPubKeyHex: COMMIT_SCRIPT,
            address: ENVELOPE.commitAddress,
        }],
        outputs: [{ address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 546 }],
        ...overrides,
    };
}

function makeHarness({ reveal = revealOf(), revealAction = ACTION } = {}) {
    const decomposed = { COMMIT, REVEAL: reveal };
    const sdk = {
        encoder: {
            createTx: vi.fn(async () => ({
                psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
            })),
        },
        actions: { createAction: vi.fn(() => ({ actionString: ACTION, action: 'FILE', version: 0 })) },
        wallet: { decomposePsbt: vi.fn((hex) => decomposed[hex]) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: false, reason: 'NO_ACTION' })),
            decodeActionFromPsbt: vi.fn(() => ({ ok: true, actionString: revealAction })),
            describe: vi.fn(() => ({ summary: 'described', details: [], warnings: [] })),
        },
    };
    return {
        sdk,
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', addressTypes: ['p2tr'] }) },
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
    };
}

const ARGS = (h) => ({
    vault: h.vault, chainRegistry: h.chainRegistry, sdkRegistry: h.sdkRegistry,
    chainId: 'bitcoin-regtest',
    actionData: { action: 'FILE', params: {} },
    encoderOpts: { pubkey: PUBKEY, rawData: 'x'.repeat(51200), encoding: 'AUTO' },
    source: SOURCE,
    ownAddresses: [SOURCE],
    signer: { source: 'hd' },
});

describe('composeActionForConfirm on the Taproot envelope lane', () => {
    it('verifies the reveal and reports both transactions\' fees', async () => {
        const h = makeHarness();
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.tamperVerified).toBe(true);
        expect(composed.revealPsbt).toBe('REVEAL');
        // Commit: 100000 in, 99000 out. Reveal: 60000 in, 546 out.
        expect(composed.envelopeFees).toEqual({ commitFeeSats: 1000, revealFeeSats: 59454, totalFeeSats: 60454 });
        // The one fee line the user approves covers both transactions.
        expect(composed.networkFeeSats).toBe(60454);
        expect(h.sdk.decoder.decodeActionFromPsbt).toHaveBeenCalledWith('REVEAL');
    });

    it('refuses a reveal that pays an address outside the wallet', async () => {
        const h = makeHarness({
            reveal: revealOf({ outputs: [{ address: 'bcrt1qattacker', scriptPubKeyHex: '0014', value: 546 }] }),
        });
        const err = await composeActionForConfirm(ARGS(h)).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.reason).toBe('REVEAL_PAYS_FOREIGN_ADDRESS');
    });

    it('refuses a reveal that carries an action other than the approved one', async () => {
        const h = makeHarness({ revealAction: 'SEND|0|XCHAIN|1000|bcrt1qattacker' });
        const err = await composeActionForConfirm(ARGS(h)).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.reason).toBe('REVEAL_ACTION_MISMATCH');
    });

    it('refuses a reveal that spends some other outpoint than the commit', async () => {
        const reveal = revealOf();
        reveal.inputs = [{ ...reveal.inputs[0], prevTxHash: 'dd'.repeat(32) }];
        const h = makeHarness({ reveal });
        const err = await composeActionForConfirm(ARGS(h)).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.reason).toBe('REVEAL_SPENDS_OTHER_OUTPOINT');
    });

    it('refuses a reveal that pulls in a second wallet coin', async () => {
        const reveal = revealOf();
        reveal.inputs = [...reveal.inputs, { prevTxHash: '99'.repeat(32), prevTxIndex: 0, value: 500000 }];
        const h = makeHarness({ reveal });
        const err = await composeActionForConfirm(ARGS(h)).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.reason).toBe('REVEAL_INPUT_COUNT');
    });

    it('leaves the envelope fields null off the envelope lane', async () => {
        const h = makeHarness();
        h.sdk.encoder.createTx = vi.fn(async () => ({ psbt: 'COMMIT', encoding: 'OP_RETURN' }));
        h.sdk.wallet.decomposePsbt = vi.fn(() => ({
            inputs: [{ value: 1000 }],
            outputs: [
                { address: null, scriptPubKeyHex: '6a', scriptType: 'nulldata', value: 0 },
                { address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 900 },
            ],
        }));
        h.sdk.decoder.decodeActionStringFromPsbt = vi.fn(() => ({ ok: true, actionString: ACTION }));
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.envelopeFees).toBeNull();
        expect(composed.networkFeeSats).toBe(100);
        expect(h.sdk.decoder.decodeActionFromPsbt).not.toHaveBeenCalled();
    });
});

describe('checkEnvelopeReveal', () => {
    const base = () => ({
        commit: COMMIT,
        reveal: revealOf(),
        envelope: ENVELOPE,
        ownAddresses: [SOURCE],
        actionString: ACTION,
        decodeRevealAction: () => ({ ok: true, actionString: ACTION }),
    });

    it('accepts the reveal the encoder builds', () => {
        expect(checkEnvelopeReveal(base())).toEqual({ ok: true });
    });

    it('refuses when the commit does not fund the recorded envelope output', () => {
        const args = base();
        args.envelope = { ...ENVELOPE, commitValue: 59999 };
        expect(checkEnvelopeReveal(args).reason).toBe('COMMIT_OUTPUT_MISMATCH');
    });

    it('refuses a reveal whose prevout script differs from the commit output', () => {
        const args = base();
        args.reveal = revealOf();
        args.reveal.inputs = [{ ...args.reveal.inputs[0], scriptPubKeyHex: `5120${'00'.repeat(32)}` }];
        expect(checkEnvelopeReveal(args).reason).toBe('REVEAL_PREVOUT_MISMATCH');
    });

    it('refuses a reveal with no outputs at all', () => {
        const args = base();
        args.reveal = revealOf({ outputs: [] });
        expect(checkEnvelopeReveal(args).reason).toBe('REVEAL_PAYS_FOREIGN_ADDRESS');
    });

    it('refuses when the envelope leaf cannot be read', () => {
        const args = base();
        args.decodeRevealAction = () => { throw new Error('unreadable'); };
        expect(checkEnvelopeReveal(args).reason).toBe('REVEAL_ACTION_MISMATCH');
    });
});

describe('envelope fee disclosure', () => {
    it('reads each transaction\'s fee off its own bytes', () => {
        expect(envelopeNetworkFees(COMMIT, revealOf())).toEqual({
            commitFeeSats: 1000, revealFeeSats: 59454, totalFeeSats: 60454,
        });
    });

    it('leaves the total unknown when either fee is', () => {
        const commit = { ...COMMIT, inputs: [{ value: null }] };
        expect(envelopeNetworkFees(commit, revealOf())).toEqual({
            commitFeeSats: null, revealFeeSats: 59454, totalFeeSats: null,
        });
    });

    it('lists the commit and the reveal with their fees', () => {
        const lines = envelopeTransactionLines({
            composed: { revealPsbt: 'REVEAL', envelopeFees: { commitFeeSats: 1000, revealFeeSats: 59454 } },
            ticker: 'BTC',
        });
        expect(lines.map((l) => l.role)).toEqual(['commit', 'reveal']);
        expect(lines[0].text).toBe('1. Commit transaction: funds the envelope, fee 0.00001 BTC');
        expect(lines[1].text).toBe('2. Reveal transaction: publishes the data and returns the rest to you, fee 0.00059454 BTC');
    });

    it('says so when a fee cannot be read, and is absent off the envelope lane', () => {
        const lines = envelopeTransactionLines({
            composed: { revealPsbt: 'REVEAL', envelopeFees: { commitFeeSats: null, revealFeeSats: 10 } },
            ticker: 'BTC',
        });
        expect(lines[0].feeSats).toBeNull();
        expect(lines[0].text).toContain('fee not known from the built transaction');
        expect(envelopeTransactionLines({ composed: { revealPsbt: null, envelopeFees: null } })).toBeNull();
    });
});
