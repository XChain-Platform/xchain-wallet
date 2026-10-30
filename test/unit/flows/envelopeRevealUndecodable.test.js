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

// An airdrop's LIST over 8 KB rides a Taproot envelope, and the SDK decoder
// refuses LIST v0's variadic ITEM field (REST_FIELD_UNSUPPORTED) even when the
// reveal carries exactly the approved bytes. The wallet refused it with "does
// not match what you approved", telling the user it was tampered with when the
// carrier binding passed on the same bytes. It still refuses, now saying the
// wallet cannot verify an action that size; a reveal whose bytes differ keeps
// the tamper wording.

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
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });

const NETWORK = 'bitcoin-regtest';
const regtest = bitcoin.networks.regtest;
const recipient = (i) => bitcoin.payments.p2wpkh({
    hash: Buffer.from(String(i + 1).padStart(40, '0'), 'hex'), network: regtest,
}).address;
const ITEMS = Array.from({ length: 200 }, (_, i) => recipient(i));
const listAction = (items) => sdk.actions.createAction({
    action: 'LIST', params: { VERSION: '0', TYPE: '2', ITEM: items },
}).actionString;
const ACTION = listAction(ITEMS);

const HONEST = 'This wallet cannot yet verify actions of this size. Split it into smaller actions.';
const MISMATCH = 'The action encoded in the transaction does not match what you approved.';

const SOURCE = recipient(9999);
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

// A reveal PSBT whose envelope leaf carries `action`, in the leaf grammar the
// SDK parses: OP_FALSE OP_IF "XCHN" 0x00 <payload pushes> OP_ENDIF <key> OP_CHECKSIG.
function revealPsbtCarrying(action) {
    const payload = bitcoin.script.compile([Buffer.from(action, 'utf8')]);
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

const realArgs = (revealPsbt) => ({
    commit: COMMIT, reveal: REVEAL, envelope: ENVELOPE, ownAddresses: [SOURCE], actionString: ACTION,
    decodeRevealAction: () => sdk.decoder.decodeActionFromPsbt(revealPsbt),
    revealPsbt, network: NETWORK,
    assertEnvelopeCarrierBinding: sdk.decoder.assertEnvelopeCarrierBinding,
});

describe('checkEnvelopeReveal on a LIST the decoder cannot read', () => {
    it('is the SDK decoder refusing LIST v0 ITEM on a byte-equal reveal', () => {
        const hex = revealPsbtCarrying(ACTION);
        expect(sdk.decoder.decodeActionFromPsbt(hex)).toMatchObject({ ok: false, reason: 'REST_FIELD_UNSUPPORTED' });
        expect(() => sdk.decoder.assertEnvelopeCarrierBinding({ revealPsbt: hex, actionString: ACTION, network: NETWORK }))
            .not.toThrow();
    });

    it('still refuses, as undecodable rather than mismatched', () => {
        expect(checkEnvelopeReveal(realArgs(revealPsbtCarrying(ACTION)))).toEqual({
            ok: false, reason: 'REVEAL_ACTION_UNDECODABLE', decodeReason: 'REST_FIELD_UNSUPPORTED',
        });
    });

    it('keeps the tamper verdict when the reveal carries a different list', () => {
        const swapped = listAction([recipient(5000), ...ITEMS.slice(1)]);
        expect(checkEnvelopeReveal(realArgs(revealPsbtCarrying(swapped))))
            .toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('keeps the tamper verdict when no binding rule can prove the bytes', () => {
        const args = { ...realArgs(revealPsbtCarrying(ACTION)), assertEnvelopeCarrierBinding: undefined };
        expect(checkEnvelopeReveal(args)).toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('keeps the mismatch verdict for any other decoder refusal', () => {
        const args = {
            ...realArgs(revealPsbtCarrying(ACTION)),
            decodeRevealAction: () => ({ ok: false, reason: 'NOT_UTF8' }),
        };
        expect(checkEnvelopeReveal(args)).toEqual({ ok: false, reason: 'REVEAL_ACTION_MISMATCH' });
    });
});

describe('every action with a repeating tail refuses honestly in an envelope', () => {
    const HASH = 'a'.repeat(64);
    const make = (action, params) => sdk.actions.createAction({ action, params }).actionString;
    it.each([
        ['LIST v1', make('LIST', { VERSION: '1', EDIT: '1', LIST_ACTION_INDEX: '12', ITEM: ITEMS })],
        ['LIST v4', make('LIST', { VERSION: '4', TYPE: '2', NAME: 'N', DESCRIPTION: 'D', ITEM: ITEMS })],
        ['DEPLOY v0', make('DEPLOY', { VERSION: '0', CODE: 'x', GAS_LIMIT: '9', CONSTRUCTOR_PARAMS: ITEMS })],
        ['DEPLOY v2', make('DEPLOY', { VERSION: '2', CODE_HASH: HASH, GAS_LIMIT: '9', CONSTRUCTOR_PARAMS: ITEMS })],
    ])('%s reads as undecodable, not as tampered, and refuses', (_name, action) => {
        const verdict = checkEnvelopeReveal({ ...realArgs(revealPsbtCarrying(action)), actionString: action });
        expect(verdict).toMatchObject({ ok: false, reason: 'REVEAL_ACTION_UNDECODABLE' });
    });
});

describe('the refusal the user reads', () => {
    it('names the size limit for an undecodable reveal and tampering for everything else', () => {
        expect(envelopeRevealRefusalMessage('REVEAL_ACTION_UNDECODABLE')).toBe(HONEST);
        for (const reason of ['REVEAL_ACTION_MISMATCH', 'REVEAL_CARRIER_BINDING', 'REVEAL_PAYS_FOREIGN_ADDRESS']) {
            expect(envelopeRevealRefusalMessage(reason)).toBe(MISMATCH);
        }
    });

    it('reads as nothing signed, without the tamper wording', () => {
        const wire = { name: 'TamperDetectedError', message: HONEST };
        const copy = submitFailureMessage(wire, { fallback: wire.message });
        expect(copy).toBe(`${HONEST} Nothing was signed.`);
        expect(copy).not.toMatch(/does not match/);
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
        actions: { createAction: vi.fn(() => ({ actionString: ACTION, action: 'LIST', version: 0 })) },
        wallet: { decomposePsbt: vi.fn((hex) => decomposed[hex]) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: false, reason: 'NO_OP_RETURN' })),
            decodeActionFromPsbt: (hex) => sdk.decoder.decodeActionFromPsbt(hex),
            describe: vi.fn(() => ({ summary: 'described', details: [], warnings: [] })),
            assertEnvelopeCarrierBinding: sdk.decoder.assertEnvelopeCarrierBinding,
        },
    };
}

describe('both signing paths refuse an undecodable reveal honestly', () => {
    it('composeActionForConfirm refuses with the size message', async () => {
        const revealSdk = sdkFor(revealPsbtCarrying(ACTION));
        const err = await composeActionForConfirm({
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', addressTypes: ['p2tr'] }) },
            sdkRegistry: { get: () => revealSdk },
            chainId: NETWORK,
            actionData: { action: 'LIST', params: { VERSION: '0', TYPE: '2', ITEM: ITEMS } },
            encoderOpts: { pubkey: `02${'11'.repeat(32)}`, encoding: 'AUTO' },
            source: SOURCE,
            ownAddresses: [SOURCE],
            signer: { source: 'hd' },
        }).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.message).toBe(HONEST);
        expect(err.details).toMatchObject({ reason: 'REVEAL_ACTION_UNDECODABLE', decodeReason: 'REST_FIELD_UNSUPPORTED' });
    });

    it('assertBuiltActionMatchesIntent refuses with the size message, and with tamper wording on other bytes', () => {
        const run = (revealPsbt) => () => assertBuiltActionMatchesIntent({
            sdk: sdkFor(revealPsbt),
            encoded: { psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt, envelope: { ...ENVELOPE } },
            actionString: ACTION,
            bareNativePayment: false,
            ownAddresses: [SOURCE],
        });
        expect(run(revealPsbtCarrying(ACTION))).toThrow(HONEST);
        expect(run(revealPsbtCarrying(listAction(ITEMS.slice(1))))).toThrow(MISMATCH);
    });
});
