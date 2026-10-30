// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The P2SH/P2WSH reveal is signed only when its outputs pay exactly the
// deferred outputs the user approved, plus wallet change and the one marker.
// Real PSBTs shaped the way the encoder's reveal legs build them, read
// through the SDK's own decomposePsbt.

import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';
import {
    RevealOutputsRefusedError,
    revealOutputsRefusal,
} from '../../../packages/core/src/sdk/p2shRevealOutputs.js';

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
const OWN = bitcoin.payments.p2wpkh({ pubkey: PUBKEY, network: NET }).address;
const addressOf = (byte) => bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, byte), network: NET }).address;
const FEE = { address: addressOf(0xfe), value: 5000 };
const ORACLE = { address: addressOf(0x0c), value: 1200 };
const ATTACKER = addressOf(0xaa);
const FUNDING_TXID = 'aa'.repeat(32);

// The commit: one data leg funded from one wallet input.
function commit(encoding) {
    const leg = encoding === 'P2WSH'
        ? bitcoin.payments.p2wsh({ redeem: { output: DATA_SCRIPT }, network: NET })
        : bitcoin.payments.p2sh({ redeem: { output: DATA_SCRIPT }, network: NET });
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(Buffer.from(FUNDING_TXID, 'hex').reverse(), 0);
    tx.addOutput(leg.output, 20000);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.setVersion(2);
    psbt.addInput({ hash: FUNDING_TXID, index: 0, witnessUtxo: { script: bitcoin.payments.p2wpkh({ pubkey: PUBKEY, network: NET }).output, value: 100000 } });
    psbt.addOutput({ script: leg.output, value: 20000 });
    return { psbtHex: psbt.toHex(), txHex: tx.toHex(), txid: tx.getId(), tx };
}

/** The encoder's marker: magic plus encoding name, 8 bytes for P2SH and 9 for P2WSH. */
const marker = (encoding, bytes = encoding === 'P2WSH' ? 9 : 8) => ({
    script: bitcoin.payments.embed({ data: [Buffer.alloc(bytes, 0x5a)] }).output, value: 0,
});
const pay = (address, value) => ({ address, value });

// The reveal: the commit leg spent at vout 0, paying `outputs` in order.
function reveal(c, encoding, outputs) {
    const psbt = new bitcoin.Psbt({ network: NET });
    for (const out of outputs) psbt.addOutput(out);
    const leg = encoding === 'P2WSH'
        ? { witnessScript: DATA_SCRIPT, witnessUtxo: { script: c.tx.outs[0].script, value: c.tx.outs[0].value } }
        : { redeemScript: DATA_SCRIPT, nonWitnessUtxo: Buffer.from(c.txHex, 'hex') };
    psbt.addInput({ hash: c.txid, index: 0, ...leg });
    return psbt.toHex();
}

const refusalOf = (encoding, outputs, deferredOutputs = [FEE, ORACLE]) => {
    const c = commit(encoding);
    return revealOutputsRefusal({
        revealOutputs: sdk.wallet.decomposePsbt(reveal(c, encoding, outputs)).outputs,
        deferredOutputs,
        ownAddresses: [OWN],
        encoding,
    });
};

describe('reveal outputs, read from real PSBTs', () => {
    it.each(['P2SH', 'P2WSH'])('passes a %s reveal paying the deferred set, its marker and own change', (encoding) => {
        expect(refusalOf(encoding, [marker(encoding), pay(FEE.address, FEE.value), pay(ORACLE.address, ORACLE.value), pay(OWN, 9000)])).toBe(null);
    });

    it('refuses a deferred payment redirected to another address', () => {
        const r = refusalOf('P2SH', [marker('P2SH'), pay(ATTACKER, FEE.value), pay(ORACLE.address, ORACLE.value)]);
        expect(r?.unexpected).toEqual([expect.objectContaining({ index: 1, address: ATTACKER })]);
        expect(r?.missing).toEqual([{ address: FEE.address, value: FEE.value }]);
    });

    it('refuses a deferred payment with a lowered amount', () => {
        const r = refusalOf('P2SH', [marker('P2SH'), pay(FEE.address, FEE.value - 1), pay(ORACLE.address, ORACLE.value)]);
        expect(r?.missing).toEqual([{ address: FEE.address, value: FEE.value }]);
    });

    it('refuses a reveal that drops a deferred payment', () => {
        const r = refusalOf('P2WSH', [marker('P2WSH'), pay(FEE.address, FEE.value), pay(OWN, 9000)]);
        expect(r?.unexpected).toEqual([]);
        expect(r?.missing).toEqual([{ address: ORACLE.address, value: ORACLE.value }]);
    });

    it('refuses change swept to an address the wallet does not hold', () => {
        const r = refusalOf('P2SH', [marker('P2SH'), pay(FEE.address, FEE.value), pay(ORACLE.address, ORACLE.value), pay(ATTACKER, 9000)]);
        expect(r?.unexpected).toEqual([expect.objectContaining({ index: 3, address: ATTACKER })]);
    });

    it('refuses a second OP_RETURN, a valued one, and one long enough to carry an action', () => {
        const paid = [pay(FEE.address, FEE.value), pay(ORACLE.address, ORACLE.value)];
        expect(refusalOf('P2SH', [marker('P2SH'), marker('P2SH'), ...paid])?.unexpected).toHaveLength(1);
        expect(refusalOf('P2SH', [{ ...marker('P2SH'), value: 1 }, ...paid])?.unexpected).toHaveLength(1);
        expect(refusalOf('P2SH', [marker('P2SH', 9), ...paid])?.unexpected).toHaveLength(1);
        expect(refusalOf('P2WSH', [marker('P2WSH', 40), ...paid])?.unexpected).toHaveLength(1);
    });

    it('matches a deferred payment to a wallet address as its slot, so its amount still counts', () => {
        const own = { address: OWN, value: 7000 };
        expect(refusalOf('P2SH', [marker('P2SH'), pay(OWN, 7000)], [own])).toBe(null);
        expect(refusalOf('P2SH', [marker('P2SH'), pay(OWN, 6999)], [own])?.missing).toEqual([own]);
    });

    it('refuses an unreadable or empty output set', () => {
        expect(revealOutputsRefusal({ revealOutputs: [], deferredOutputs: [], ownAddresses: [OWN], encoding: 'P2SH' })).not.toBe(null);
        expect(revealOutputsRefusal({ revealOutputs: null, deferredOutputs: [], ownAddresses: [OWN], encoding: 'P2SH' })).not.toBe(null);
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
        broadcastTx, signPsbt, spendP2sh: live.encoder.spendP2sh,
        args: {
            sdkRegistry: { get: () => live },
            chainRegistry: { get: () => ({ id: 'bitcoin-regtest', coin: 'bitcoin' }) },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '1' } },
            encoderOpts: { pubkey: PUBKEY.toString('hex'), sourceAddress: OWN, change: OWN, customOutputs: [{ ...FEE }] },
            signer: { kind: 'software', signPsbt },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
        },
    };
}

describe('submitWithSigner refuses a reveal that does not pay what was approved', () => {
    it('signs and broadcasts an honest reveal of the deferred fee', async () => {
        const c = commit('P2SH');
        const h = harness('P2SH', reveal(c, 'P2SH', [marker('P2SH'), pay(FEE.address, FEE.value), pay(OWN, 9000)]), c);
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs).toEqual([FEE]);
        expect(h.signPsbt).toHaveBeenCalledTimes(2);
        expect(h.broadcastTx).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['redirects the fee', () => [marker('P2SH'), pay(ATTACKER, FEE.value)]],
        ['drops the fee', () => [marker('P2SH'), pay(OWN, 9000)]],
    ])('never signs a reveal that %s, and broadcasts nothing', async (_label, outputs) => {
        const c = commit('P2SH');
        const h = harness('P2SH', reveal(c, 'P2SH', outputs()), c);

        const err = await submitWithSigner(h.args).catch((e) => e);

        expect(err).toBeInstanceOf(RevealOutputsRefusedError);
        expect(err).toMatchObject({
            code: 'REVEAL_OUTPUTS_REFUSED', phase: 'phase2',
            phase1Txid: c.txid, phase1TxHex: c.txHex, chainId: 'bitcoin-regtest', encoding: 'P2SH',
        });
        expect(h.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.signPsbt.mock.calls[0][0].psbtHex).toBe(c.psbtHex);
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });
});
