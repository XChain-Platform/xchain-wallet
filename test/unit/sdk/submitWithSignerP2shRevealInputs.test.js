// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The P2SH/P2WSH reveal is signed only when every input spends a data leg of
// the commit. Real PSBTs, shaped the way the encoder's spendP2shLeg and
// spendP2wshLeg build them, read through the SDK's own decomposePsbt.

import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { submitWithSigner, RevealInputsRefusedError } from '../../../packages/core/src/sdk/submitWithSigner.js';
import { revealInputsRefusal } from '../../../packages/core/src/sdk/p2shRevealInputs.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false, compactTickers: false, compactAddresses: false });

const NET = bitcoin.networks.regtest;
const PUBKEY = Buffer.from('02' + '11'.repeat(32), 'hex');
const DATA_SCRIPT = bitcoin.script.compile([
    Buffer.from('XCHAIN chunk payload', 'utf8'),
    bitcoin.opcodes.OP_DROP, bitcoin.opcodes.OP_DUP, bitcoin.opcodes.OP_HASH160,
    bitcoin.crypto.hash160(PUBKEY), bitcoin.opcodes.OP_EQUALVERIFY, bitcoin.opcodes.OP_CHECKSIG,
]);
const KEY_P2WPKH = bitcoin.payments.p2wpkh({ pubkey: PUBKEY, network: NET });
const NESTED = bitcoin.payments.p2sh({ redeem: KEY_P2WPKH, network: NET });
const FUNDING_TXID = 'aa'.repeat(32);

// The commit: [data leg, nested-segwit change, native change], one wallet input.
function commit(encoding) {
    const leg = encoding === 'P2WSH'
        ? bitcoin.payments.p2wsh({ redeem: { output: DATA_SCRIPT }, network: NET })
        : bitcoin.payments.p2sh({ redeem: { output: DATA_SCRIPT }, network: NET });
    const outs = [[leg.output, 20000], [NESTED.output, 30000], [KEY_P2WPKH.output, 40000]];
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(Buffer.from(FUNDING_TXID, 'hex').reverse(), 0);
    for (const [script, value] of outs) tx.addOutput(script, value);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.setVersion(2);
    psbt.addInput({ hash: FUNDING_TXID, index: 0, witnessUtxo: { script: KEY_P2WPKH.output, value: 100000 } });
    for (const [script, value] of outs) psbt.addOutput({ script, value });
    return { psbtHex: psbt.toHex(), txHex: tx.toHex(), txid: tx.getId(), tx };
}

// The reveal: a zero-value OP_RETURN marker, the leg spent at vout 0, plus `extra` inputs.
function reveal(c, encoding, extra = []) {
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from('marker')] }).output, value: 0 });
    const leg = encoding === 'P2WSH'
        ? { witnessScript: DATA_SCRIPT, witnessUtxo: { script: c.tx.outs[0].script, value: c.tx.outs[0].value } }
        : { redeemScript: DATA_SCRIPT, nonWitnessUtxo: Buffer.from(c.txHex, 'hex') };
    psbt.addInput({ hash: c.txid, index: 0, ...leg });
    for (const input of extra) psbt.addInput(input);
    return psbt.toHex();
}

const refusalOf = (c, encoding, revealHex) => revealInputsRefusal({
    revealInputs: sdk.wallet.decomposePsbt(revealHex).inputs,
    phase1Outputs: sdk.wallet.decomposePsbt(c.psbtHex).outputs,
    phase1Txid: c.txid,
    encoding,
});

describe('reveal inputs, read from real PSBTs', () => {
    it.each(['P2SH', 'P2WSH'])('passes a %s reveal that spends only the commit data leg', (encoding) => {
        const c = commit(encoding);
        expect(refusalOf(c, encoding, reveal(c, encoding))).toBe(null);
    });

    it('refuses a reveal that adds a wallet coin from outside the commit', () => {
        const c = commit('P2SH');
        const hex = reveal(c, 'P2SH', [{ hash: 'bb'.repeat(32), index: 1, witnessUtxo: { script: KEY_P2WPKH.output, value: 50000 } }]);
        expect(refusalOf(c, 'P2SH', hex)).toEqual({ reason: 'spends coin from outside the commit', inputIndex: 1 });
    });

    it("refuses a reveal that spends the commit's own native change", () => {
        const c = commit('P2WSH');
        const hex = reveal(c, 'P2WSH', [{ hash: c.txid, index: 2, witnessUtxo: { script: KEY_P2WPKH.output, value: 40000 } }]);
        expect(refusalOf(c, 'P2WSH', hex)).toEqual({ reason: 'spends a commit output that is not a data leg', inputIndex: 1 });
    });

    it("refuses a reveal that unlocks the commit's nested-segwit change, which also pays P2SH", () => {
        const c = commit('P2SH');
        const hex = reveal(c, 'P2SH', [{ hash: c.txid, index: 1, redeemScript: KEY_P2WPKH.output, nonWitnessUtxo: Buffer.from(c.txHex, 'hex') }]);
        expect(refusalOf(c, 'P2SH', hex)).toEqual({ reason: 'unlocks a key script, not a data script', inputIndex: 1 });
    });

    it('refuses an unreadable or empty input set, and an encoding with no legs', () => {
        const c = commit('P2SH');
        const phase1Outputs = sdk.wallet.decomposePsbt(c.psbtHex).outputs;
        expect(revealInputsRefusal({ revealInputs: [], phase1Outputs, phase1Txid: c.txid, encoding: 'P2SH' })?.inputIndex).toBe(null);
        expect(revealInputsRefusal({ revealInputs: null, phase1Outputs, phase1Txid: c.txid, encoding: 'P2SH' })).not.toBe(null);
        expect(revealInputsRefusal({ revealInputs: [{}], phase1Outputs, phase1Txid: c.txid, encoding: 'OP_RETURN' })).not.toBe(null);
    });
});

function harness(encoding, revealHex, c) {
    const broadcastTx = vi.fn(async () => ({}));
    const live = {
        encoder: {
            createTx: vi.fn(async () => ({ psbt: c.psbtHex, encoding })),
            spendP2sh: vi.fn(async () => ({ psbt: revealHex })),
            broadcastTx,
        },
        actions: { createAction: vi.fn(() => ({ actionString: 'DEPLOY|0|x|1', action: 'DEPLOY', version: 0 })) },
        wallet: sdk.wallet,
    };
    const signPsbt = vi.fn(async ({ psbtHex }) => (psbtHex === c.psbtHex
        ? { txHex: c.txHex, txid: c.txid }
        : { txHex: 'REVEAL-TX', txid: 'cc'.repeat(32) }));
    return {
        broadcastTx, signPsbt,
        args: {
            sdkRegistry: { get: () => live },
            chainRegistry: { get: () => ({ id: 'bitcoin-regtest', coin: 'bitcoin' }) },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '1' } },
            encoderOpts: { pubkey: PUBKEY.toString('hex') },
            signer: { kind: 'software', signPsbt },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
        },
    };
}

describe('submitWithSigner refuses a reveal that moves other coin', () => {
    it.each(['P2SH', 'P2WSH'])('signs and broadcasts a clean %s reveal', async (encoding) => {
        const c = commit(encoding);
        const h = harness(encoding, reveal(c, encoding), c);
        const result = await submitWithSigner(h.args);
        expect(h.signPsbt).toHaveBeenCalledTimes(2);
        expect(h.broadcastTx).toHaveBeenCalledTimes(2);
        expect(result.txid).toBe('cc'.repeat(32));
    });

    it('never signs a tampered reveal, and hands back what a clean one needs', async () => {
        const c = commit('P2SH');
        const tampered = reveal(c, 'P2SH', [{ hash: c.txid, index: 2, witnessUtxo: { script: KEY_P2WPKH.output, value: 40000 } }]);
        const h = harness('P2SH', tampered, c);

        const err = await submitWithSigner(h.args).catch((e) => e);

        expect(err).toBeInstanceOf(RevealInputsRefusedError);
        expect(err).toMatchObject({
            code: 'REVEAL_INPUTS_REFUSED', phase: 'phase2', inputIndex: 1,
            phase1Txid: c.txid, phase1TxHex: c.txHex, chainId: 'bitcoin-regtest', encoding: 'P2SH',
        });
        expect(h.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.signPsbt.mock.calls[0][0].psbtHex).toBe(c.psbtHex);
        expect(h.broadcastTx).toHaveBeenCalledTimes(1);
    });
});
