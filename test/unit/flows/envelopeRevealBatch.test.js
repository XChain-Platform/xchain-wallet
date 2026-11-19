// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token-gated encrypted FILE publish is one BATCH (FILE plus a self-addressed
// MESSAGE), and over Taproot it rides an envelope reveal. The SDK co-signer
// decoder refuses every BATCH by design (BATCH_UNSUPPORTED), so the reveal
// check refused the wallet's own BATCH as "does not match what you approved"
// before review, even though the carrier binding proved the leaf carried the
// approved bytes. A BATCH the wallet composed now passes once the binding
// passes; a tampered BATCH and every other undecodable action still refuse.

import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import {
    checkEnvelopeReveal,
    envelopeRevealRefusalMessage,
} from '../../../packages/core/src/flows/envelopeRevealCheck.js';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { assertBuiltActionMatchesIntent } from '../../../packages/core/src/flows/verifyBuiltAction.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });

const NETWORK = 'bitcoin-regtest';
const regtest = bitcoin.networks.regtest;
const SOURCE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 9), network: regtest }).address;
const MISMATCH = 'The action encoded in the transaction does not match what you approved.';
const HONEST = 'This wallet cannot yet verify actions of this size. Split it into smaller actions.';

// The gated publish exactly as prepareGatedPublish composes it.
const KEY_HASH = 'a'.repeat(64);
const gatedBatch = (keyHash) => {
    const fileCmd = ['FILE', '0', 'note.txt', 'text/plain', '', '', 'GMA468991', '1', keyHash].join('|');
    const messageCmd = ['MESSAGE', '2', 'BTC', SOURCE, 'ab'.repeat(113)].join('|');
    return sdk.actions.createAction({
        action: 'BATCH', params: { VERSION: '0', COMMAND: `${fileCmd};${messageCmd}` },
    }).actionString;
};
const BATCH = gatedBatch(KEY_HASH);
const CIPHERTEXT = Buffer.alloc(128, 0x5a);
const PLAIN_FILE = sdk.actions.createAction({
    action: 'FILE', params: { VERSION: '0', NAME: 'note.txt', TYPE: 'text/plain' },
}).actionString;

const COMMIT_SCRIPT = `5120${'ee'.repeat(32)}`;
const ENVELOPE = Object.freeze({
    commitTxid: 'aa'.repeat(32), commitVout: 0, commitValue: 60000, commitAddress: 'bcrt1pcommit',
    internalPubkey: 'bb'.repeat(32), tapleafHash: 'cc'.repeat(32),
});
const COMMIT = Object.freeze({
    inputs: [{ prevTxHash: 'ff'.repeat(32), prevTxIndex: 1, value: 100000, scriptPubKeyHex: '0014', address: SOURCE }],
    outputs: [
        { address: ENVELOPE.commitAddress, scriptPubKeyHex: COMMIT_SCRIPT, scriptType: 'p2tr', value: 60000 },
        { address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 39000 },
    ],
});
const REVEAL = Object.freeze({
    inputs: [{ prevTxHash: ENVELOPE.commitTxid, prevTxIndex: 0, value: 60000, scriptPubKeyHex: COMMIT_SCRIPT }],
    outputs: [{ address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 546 }],
});

// A reveal PSBT whose envelope leaf carries `action` and the binary rawData,
// as the encoder writes it: compile([utf8(action), rawData]) inside
// OP_FALSE OP_IF "XCHN" 0x00 <payload pushes> OP_ENDIF <key> OP_CHECKSIG.
function revealPsbtCarrying(action, rawData = CIPHERTEXT) {
    const payload = bitcoin.script.compile([Buffer.from(action, 'utf8'), ...(rawData ? [rawData] : [])]);
    const pushes = [];
    for (let at = 0; at < payload.length; at += 520) pushes.push(payload.subarray(at, at + 520));
    const script = bitcoin.script.compile([
        bitcoin.opcodes.OP_0, bitcoin.opcodes.OP_IF, Buffer.from('XCHN'), Buffer.from([0]),
        ...pushes, bitcoin.opcodes.OP_ENDIF, Buffer.alloc(32, 7), bitcoin.opcodes.OP_CHECKSIG,
    ]);
    const psbt = new bitcoin.Psbt({ network: regtest });
    psbt.addInput({
        hash: ENVELOPE.commitTxid, index: 0,
        witnessUtxo: { script: Buffer.from(COMMIT_SCRIPT, 'hex'), value: 60000 },
        tapLeafScript: [{ leafVersion: 0xc0, script, controlBlock: Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(32, 7)]) }],
    });
    psbt.addOutput({ address: SOURCE, value: 546 });
    return psbt.toHex();
}

// One byte of the approved string changed, as a substituted leaf would carry it.
const oneByteOff = (s) => `${s.slice(0, -1)}${s.endsWith('a') ? 'b' : 'a'}`;

// Bind the file bytes the leaf carries, as the composing caller does.
const realArgs = (revealPsbt, actionString = BATCH, rawData = CIPHERTEXT) => ({
    commit: COMMIT, reveal: REVEAL, envelope: ENVELOPE, ownAddresses: [SOURCE], actionString,
    decodeRevealAction: () => sdk.decoder.decodeActionFromPsbt(revealPsbt),
    revealPsbt, network: NETWORK, rawData,
    assertEnvelopeCarrierBinding: sdk.decoder.assertEnvelopeCarrierBinding,
});

describe('checkEnvelopeReveal on a BATCH the wallet composed', () => {
    it('is the SDK co-signer decoder refusing BATCH on a byte-equal reveal the binding accepts', () => {
        const hex = revealPsbtCarrying(BATCH);
        expect(sdk.decoder.decodeActionFromPsbt(hex)).toMatchObject({ ok: false, reason: 'BATCH_UNSUPPORTED' });
        expect(() => sdk.decoder.assertEnvelopeCarrierBinding({ revealPsbt: hex, actionString: BATCH, network: NETWORK }))
            .not.toThrow();
    });

    it('passes a gated FILE plus MESSAGE BATCH carried exactly', () => {
        expect(checkEnvelopeReveal(realArgs(revealPsbtCarrying(BATCH)))).toEqual({ ok: true });
    });

    it('passes a plain FILE carried exactly', () => {
        const text = Buffer.from('hello world '.repeat(8));
        const hex = revealPsbtCarrying(PLAIN_FILE, text);
        expect(sdk.decoder.decodeActionFromPsbt(hex)).toMatchObject({ ok: true, actionString: PLAIN_FILE });
        expect(checkEnvelopeReveal(realArgs(hex, PLAIN_FILE, text))).toEqual({ ok: true });
    });

    it('refuses a BATCH with one changed byte as tampered', () => {
        const hex = revealPsbtCarrying(oneByteOff(BATCH));
        expect(sdk.decoder.decodeActionFromPsbt(hex)).toMatchObject({ ok: false, reason: 'BATCH_UNSUPPORTED' });
        expect(checkEnvelopeReveal(realArgs(hex))).toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('refuses a BATCH carrying another key hash as tampered', () => {
        const hex = revealPsbtCarrying(gatedBatch('f'.repeat(64)));
        expect(checkEnvelopeReveal(realArgs(hex))).toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('refuses a BATCH when no binding rule can prove the bytes', () => {
        const args = { ...realArgs(revealPsbtCarrying(BATCH)), assertEnvelopeCarrierBinding: undefined };
        expect(checkEnvelopeReveal(args)).toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('refuses a leaf carrying a BATCH when the user approved a plain FILE', () => {
        const hex = revealPsbtCarrying(BATCH);
        expect(checkEnvelopeReveal(realArgs(hex, PLAIN_FILE))).toEqual({ ok: false, reason: 'REVEAL_ACTION_MISMATCH' });
    });
});

describe('every other undecodable action still refuses', () => {
    it('keeps the mismatch verdict for a non-BATCH decoder refusal on byte-equal bytes', () => {
        const hex = revealPsbtCarrying(PLAIN_FILE);
        const args = { ...realArgs(hex, PLAIN_FILE), decodeRevealAction: () => ({ ok: false, reason: 'FIELD_COUNT_MISMATCH' }) };
        expect(checkEnvelopeReveal(args)).toEqual({ ok: false, reason: 'REVEAL_ACTION_MISMATCH' });
    });

    it('keeps the undecodable verdict for a real LIST the decoder cannot read', () => {
        const items = Array.from({ length: 5 }, (_, i) => bitcoin.payments.p2wpkh({
            hash: Buffer.alloc(20, i + 1), network: regtest,
        }).address);
        const list = sdk.actions.createAction({ action: 'LIST', params: { VERSION: '0', TYPE: '2', ITEM: items } }).actionString;
        const hex = revealPsbtCarrying(list, null);
        expect(checkEnvelopeReveal(realArgs(hex, list, null)))
            .toEqual({ ok: false, reason: 'REVEAL_ACTION_UNDECODABLE', decodeReason: 'REST_FIELD_UNSUPPORTED' });
    });

    it('does not let a decoder claiming BATCH_UNSUPPORTED pass a non-BATCH approval', () => {
        const hex = revealPsbtCarrying(PLAIN_FILE);
        const args = { ...realArgs(hex, PLAIN_FILE), decodeRevealAction: () => ({ ok: false, reason: 'BATCH_UNSUPPORTED' }) };
        expect(checkEnvelopeReveal(args)).toEqual({ ok: false, reason: 'REVEAL_ACTION_MISMATCH' });
    });

    it('keeps the user-facing wording unchanged', () => {
        expect(envelopeRevealRefusalMessage('REVEAL_ACTION_MISMATCH')).toBe(MISMATCH);
        expect(envelopeRevealRefusalMessage('REVEAL_CARRIER_BINDING')).toBe(MISMATCH);
        expect(envelopeRevealRefusalMessage('REVEAL_ACTION_UNDECODABLE')).toBe(HONEST);
    });
});

function sdkFor(revealPsbt) {
    const decomposed = { COMMIT, [revealPsbt]: REVEAL };
    return {
        config: { network: NETWORK },
        encoder: {
            createTx: vi.fn(async () => ({
                psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt, envelope: { ...ENVELOPE },
            })),
        },
        actions: { createAction: vi.fn(() => ({ actionString: BATCH, action: 'BATCH', version: 0 })) },
        wallet: { decomposePsbt: vi.fn((hex) => decomposed[hex]) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: false, reason: 'NO_OP_RETURN' })),
            decodeActionFromPsbt: (hex) => sdk.decoder.decodeActionFromPsbt(hex),
            describe: vi.fn(() => ({ summary: 'described', details: [], warnings: [] })),
            assertEnvelopeCarrierBinding: sdk.decoder.assertEnvelopeCarrierBinding,
        },
    };
}

describe('both signing paths accept the gated BATCH and refuse a tampered one', () => {
    const compose = (revealPsbt) => composeActionForConfirm({
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
        chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', addressTypes: ['p2tr'] }) },
        sdkRegistry: { get: () => sdkFor(revealPsbt) },
        chainId: NETWORK,
        actionData: { action: 'BATCH', params: { VERSION: '0', COMMAND: BATCH.slice('BATCH|0|'.length) } },
        encoderOpts: { pubkey: `02${'11'.repeat(32)}`, rawData: CIPHERTEXT.toString('binary'), encoding: 'AUTO' },
        source: SOURCE,
        ownAddresses: [SOURCE],
        signer: { source: 'hd' },
    });

    it('composeActionForConfirm composes the gated BATCH for review', async () => {
        const composed = await compose(revealPsbtCarrying(BATCH));
        expect(composed.tamperVerified).toBe(true);
    });

    it('composeActionForConfirm refuses a one-byte-off BATCH with the tamper wording', async () => {
        const err = await compose(revealPsbtCarrying(oneByteOff(BATCH))).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.message).toBe(MISMATCH);
        expect(err.details).toMatchObject({ reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('assertBuiltActionMatchesIntent accepts the gated BATCH and refuses a one-byte-off one', () => {
        const run = (revealPsbt) => () => assertBuiltActionMatchesIntent({
            sdk: sdkFor(revealPsbt),
            encoded: { psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt, envelope: { ...ENVELOPE } },
            actionString: BATCH,
            rawData: CIPHERTEXT.toString('binary'),
            bareNativePayment: false,
            ownAddresses: [SOURCE],
        });
        expect(run(revealPsbtCarrying(BATCH))).not.toThrow();
        expect(run(revealPsbtCarrying(oneByteOff(BATCH)))).toThrow(MISMATCH);
    });
});
