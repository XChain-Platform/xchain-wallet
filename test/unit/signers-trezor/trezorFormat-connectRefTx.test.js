/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The previous transactions the real SDK decomposer attaches must reach
// Connect in the shape Connect validates. @trezor/connect is not a
// dependency here, so connectRefTxProblems restates the checks
// validateReferencedTransactions runs on a refTx given as an object
// (@trezor/connect 9.7.4 lib/api/bitcoin/refTx.js, the same in
// @trezor/connect-core 10.0.1): hash a string, version and lock_time
// numbers, at least one PrevInput (prev_hash and script_sig strings,
// prev_index and sequence numbers; @trezor/protobuf 1.5.3) and at least one
// TxOutputBinType (amount a Uint, script_pubkey a string), where a Uint is a
// safe integer or a decimal string with no leading zero (@trezor/schema-utils
// 1.4.0), plus a refTx for every input's prev_hash.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { toTrezorSignTransaction } from '../../../packages/signers-trezor/src/trezorFormat.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false, compactTickers: false, compactAddresses: false });

const NET = bitcoin.networks.regtest;
const PREV_LOCKTIME = 500000;
const KEY_HASH = Buffer.alloc(20, 3);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isUint = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
    || (isStr(v) && /^(?:[1-9]\d*|\d)$/.test(v));

function connectRefTxProblems(tx) {
    const problems = [];
    if (!isStr(tx?.hash)) problems.push('hash');
    if (!isNum(tx?.version)) problems.push('version');
    if (!isNum(tx?.lock_time)) problems.push('lock_time');
    const inputs = Array.isArray(tx?.inputs) ? tx.inputs : [];
    if (inputs.length < 1) problems.push('inputs');
    inputs.forEach((i, n) => {
        if (!isStr(i?.prev_hash) || !isNum(i?.prev_index) || !isStr(i?.script_sig) || !isNum(i?.sequence)) {
            problems.push(`inputs[${n}]`);
        }
    });
    const outs = Array.isArray(tx?.bin_outputs) ? tx.bin_outputs : [];
    if (outs.length < 1) problems.push('bin_outputs');
    outs.forEach((o, n) => {
        if (!isUint(o?.amount) || !isStr(o?.script_pubkey)) problems.push(`bin_outputs[${n}]`);
    });
    return problems;
}

function prevTx({ version, scriptSig, output }) {
    const prev = new bitcoin.Transaction();
    prev.version = version;
    prev.locktime = PREV_LOCKTIME;
    prev.addInput(Buffer.alloc(32, 5), 2, 0xfffffffe, scriptSig);
    prev.addOutput(output, 1_000_000);
    return prev;
}

// A legacy p2pkh spend: the SDK reads the previous transaction from nonWitnessUtxo.
function legacySpend() {
    const prev = prevTx({ version: 1, scriptSig: Buffer.from('0151', 'hex'), output: bitcoin.payments.p2pkh({ hash: KEY_HASH, network: NET }).output });
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput({ hash: prev.getId(), index: 0, nonWitnessUtxo: prev.toBuffer() });
    psbt.addOutput({ address: bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network: NET }).address, value: 990_000 });
    return { prev, decomposed: sdk.wallet.decomposePsbt(psbt.toHex()) };
}

// A p2wpkh spend carrying both UTXO fields, the shape a device send gets: the
// SDK takes value and script from witnessUtxo and the previous transaction
// from nonWitnessUtxo. Its previous input has an empty script_sig.
function segwitSpend() {
    const output = bitcoin.payments.p2wpkh({ hash: KEY_HASH, network: NET }).output;
    const prev = prevTx({ version: 2, scriptSig: Buffer.alloc(0), output });
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput({
        hash: prev.getId(), index: 0, witnessUtxo: { script: output, value: 1_000_000 }, nonWitnessUtxo: prev.toBuffer(),
    });
    psbt.addOutput({ address: bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network: NET }).address, value: 990_000 });
    return { prev, decomposed: sdk.wallet.decomposePsbt(psbt.toHex()) };
}

describe('Trezor refTxs built from the real SDK decomposition', () => {
    it('the SDK object as decomposed fails the Connect refTx checks on lock_time', () => {
        const { decomposed } = legacySpend();
        const info = decomposed.inputs[0].prevTxInfo;
        expect(info.locktime).toBe(PREV_LOCKTIME);
        expect(connectRefTxProblems(info)).toEqual(['lock_time']);
    });

    it('the converted refTx passes the Connect refTx checks and carries the previous lock time', () => {
        const { prev, decomposed } = legacySpend();
        const payload = toTrezorSignTransaction({ decomposed, coin: 'regtest', signingPaths: [{ inputIndex: 0, path: "m/44'/1'/0'/0/0" }] });

        expect(payload.refTxs).toHaveLength(1);
        const [ref] = payload.refTxs;
        expect(connectRefTxProblems(ref)).toEqual([]);
        expect(ref.lock_time).toBe(PREV_LOCKTIME);
        expect(ref).not.toHaveProperty('locktime');
        expect(ref.hash).toBe(prev.getId());
        expect(payload.inputs.map((i) => i.prev_hash)).toEqual([ref.hash]);
        expect(ref.inputs).toEqual([{
            prev_hash: '05'.repeat(32), prev_index: 2, script_sig: '0151', sequence: 0xfffffffe,
        }]);
        expect(ref.bin_outputs).toEqual([{
            amount: '1000000',
            script_pubkey: bitcoin.payments.p2pkh({ hash: KEY_HASH, network: NET }).output.toString('hex'),
        }]);
    });

    it('a segwit input carrying both UTXO fields yields a refTx that passes the Connect checks', () => {
        const { prev, decomposed } = segwitSpend();
        expect(decomposed.inputs[0].prevTxInfo).toBeTruthy();
        const payload = toTrezorSignTransaction({ decomposed, coin: 'regtest', signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }] });

        expect(payload.inputs[0].script_type).toBe('SPENDWITNESS');
        expect(payload.refTxs).toHaveLength(1);
        const [ref] = payload.refTxs;
        expect(connectRefTxProblems(ref)).toEqual([]);
        expect(ref.hash).toBe(prev.getId());
        expect(ref.lock_time).toBe(PREV_LOCKTIME);
        expect(ref.version).toBe(2);
        expect(ref.inputs[0].script_sig).toBe('');
    });
});
