// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// `verifyBuiltTx` against REAL PSBT bytes and the REAL SDK.
//
// The sibling test drives the check with string PSBTs and a fake decoder,
// which proves the wiring but not that an honest encoder answer passes. Here
// the encoder's answer is a real bitcoinjs PSBT carrying a real obfuscated
// XChain OP_RETURN (the inverse of the SDK's own extractor), and the SDK is
// the wallet's real registry, so decomposePsbt and decodeActionStringFromPsbt
// are the code that runs in the shells. Each honest fixture is submitted with
// the flag off and on; both runs must hand the signer and the broadcast the
// same bytes, which are exactly the bytes the encoder built.

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const bitcoin = require('bitcoinjs-lib');

const CHAIN_ID = 'bitcoin-regtest';
const NET = bitcoin.networks.regtest;
// G, 2G and 3G on secp256k1: valid compressed points with no private key in play.
const PUB_SOURCE = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PUB_DEST = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const PUB_OTHER = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
const p2wpkh = (pubHex) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pubHex, 'hex'), network: NET });
const SOURCE = p2wpkh(PUB_SOURCE).address;
const DEST = p2wpkh(PUB_DEST).address;
const OTHER = p2wpkh(PUB_OTHER).address;
const PREV_TXID = '1f'.repeat(16) + '2e'.repeat(16);

// The encoder's carrier: AES-128-CTR keyed off the first input's txid over
// MAGIC_WORD || compiled push of the action string (the SDK extractor's inverse).
function opReturnFor(actionString) {
    const body = Buffer.concat([
        Buffer.from('XCHN'),
        bitcoin.script.compile([Buffer.from(actionString, 'utf8')]),
    ]);
    const cipher = crypto.createCipheriv('aes-128-ctr', PREV_TXID.slice(0, 16), PREV_TXID.slice(16, 32));
    const data = Buffer.concat([cipher.update(body), cipher.final()]);
    return bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, data]);
}

/** A real PSBT spending one P2WPKH input of the source, with `outputs` in order. */
function buildPsbt(outputs) {
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput({
        hash: PREV_TXID,
        index: 0,
        witnessUtxo: { script: p2wpkh(PUB_SOURCE).output, value: 100_000_000 },
    });
    for (const o of outputs) {
        if (o.actionString) psbt.addOutput({ script: opReturnFor(o.actionString), value: 0 });
        else psbt.addOutput({ address: o.address, value: o.value });
    }
    return psbt.toHex();
}

function realSdk() {
    const registry = new SDKRegistry({
        chainRegistry: defaultRegistry(),
        sdkFactory: adaptXChainSDK(XChainSDK),
    });
    return { registry, sdk: registry.get(CHAIN_ID) };
}

/**
 * Submit `actionData` with the encoder answering `outputsFor(actionString)`.
 * Returns what reached the encoder, the signer and the broadcast.
 */
async function submit({ actionData, outputsFor, verifyBuiltTx, customOutputs }) {
    const { registry, sdk } = realSdk();
    const actionString = sdk.actions.createAction(actionData).actionString;
    const psbtHex = buildPsbt(outputsFor(actionString));
    const createTx = vi.spyOn(sdk.encoder, 'createTx').mockResolvedValue({ psbt: psbtHex, encoding: 'OP_RETURN' });
    const broadcastTx = vi.spyOn(sdk.encoder, 'broadcastTx').mockResolvedValue({ txid: 'b'.repeat(64) });
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async (req) => ({ txHex: `signed:${req.psbtHex}`, txid: 'b'.repeat(64) })),
    };
    let error = null;
    try {
        await submitWithSigner({
            sdkRegistry: registry,
            chainRegistry: defaultRegistry(),
            chainId: CHAIN_ID,
            actionData,
            encoderOpts: {
                pubkey: PUB_SOURCE,
                sourceAddress: SOURCE,
                change: SOURCE,
                ...(customOutputs ? { customOutputs: customOutputs.map((o) => ({ ...o })) } : {}),
            },
            signer,
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            verifyBuiltTx,
        });
    } catch (err) {
        error = err;
    }
    return {
        psbtHex,
        error,
        createTxArgs: createTx.mock.calls.map((c) => c[0]),
        signCalls: signer.signPsbt.mock.calls.map((c) => c[0]),
        broadcasts: broadcastTx.mock.calls.map((c) => c[0]),
    };
}

/** Off and on must build, sign and broadcast the same thing, and sign the encoder's bytes. */
async function expectSameBytesBothWays(fixture) {
    const off = await submit({ ...fixture, verifyBuiltTx: false });
    const on = await submit({ ...fixture, verifyBuiltTx: true });
    expect(off.error).toBeNull();
    expect(on.error).toBeNull();
    expect(on.createTxArgs).toEqual(off.createTxArgs);
    expect(on.signCalls).toEqual(off.signCalls);
    expect(on.broadcasts).toEqual(off.broadcasts);
    expect(on.signCalls).toHaveLength(1);
    expect(on.signCalls[0].psbtHex).toBe(on.psbtHex);
    expect(on.broadcasts).toEqual([`signed:${on.psbtHex}`]);
}

const TOKEN_SEND = { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '5', DESTINATION: DEST } };
const TOKEN_SEND_MEMO = { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '5', DESTINATION: DEST, MEMO: 'invoice 42' } };
const NATIVE_SEND = { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.5', DESTINATION: DEST } };
const SWEEP = {
    action: 'SWEEP',
    params: { DESTINATION: DEST, BALANCES: '1', OWNERSHIPS: '1', ORDERS: '0', SWAPS: '0', DISPENSERS: '0' },
};

describe('verifyBuiltTx on real PSBT bytes: an honest build signs the same bytes either way', () => {
    it('token SEND (inline OP_RETURN plus change)', async () => {
        await expectSameBytesBothWays({
            actionData: TOKEN_SEND,
            outputsFor: (s) => [{ actionString: s }, { address: SOURCE, value: 99_990_000 }],
        });
    });

    it('token SEND with a memo', async () => {
        await expectSameBytesBothWays({
            actionData: TOKEN_SEND_MEMO,
            outputsFor: (s) => [{ actionString: s }, { address: SOURCE, value: 99_990_000 }],
        });
    });

    it('bare native SEND (payment output plus change)', async () => {
        await expectSameBytesBothWays({
            actionData: NATIVE_SEND,
            outputsFor: () => [{ address: DEST, value: 50_000_000 }, { address: SOURCE, value: 49_990_000 }],
        });
    });

    it('SWEEP', async () => {
        await expectSameBytesBothWays({
            actionData: SWEEP,
            outputsFor: (s) => [{ actionString: s }, { address: SOURCE, value: 99_990_000 }],
        });
    });

    it('token SEND carrying a requested extra output (a donation)', async () => {
        await expectSameBytesBothWays({
            actionData: TOKEN_SEND,
            customOutputs: [{ address: OTHER, value: 1000 }],
            outputsFor: (s) => [
                { actionString: s },
                { address: OTHER, value: 1000 },
                { address: SOURCE, value: 99_989_000 },
            ],
        });
    });
});

describe('verifyBuiltTx on real PSBT bytes: a tampered build is refused unsigned', () => {
    it('token SEND whose real OP_RETURN names another destination', async () => {
        const res = await submit({
            actionData: TOKEN_SEND,
            verifyBuiltTx: true,
            outputsFor: (s) => [{ actionString: s.replace(DEST, OTHER) }, { address: SOURCE, value: 99_990_000 }],
        });
        expect(res.error?.name).toBe('TamperDetectedError');
        expect(res.signCalls).toHaveLength(0);
        expect(res.broadcasts).toHaveLength(0);
    });

    it('bare native SEND paid to another address', async () => {
        const res = await submit({
            actionData: NATIVE_SEND,
            verifyBuiltTx: true,
            outputsFor: () => [{ address: OTHER, value: 50_000_000 }, { address: SOURCE, value: 49_990_000 }],
        });
        expect(res.error?.name).toBe('TamperDetectedError');
        expect(res.signCalls).toHaveLength(0);
        expect(res.broadcasts).toHaveLength(0);
    });

    it('the same tampered native SEND still signs with the flag off (other callers unchanged)', async () => {
        const res = await submit({
            actionData: NATIVE_SEND,
            verifyBuiltTx: false,
            outputsFor: () => [{ address: OTHER, value: 50_000_000 }, { address: SOURCE, value: 49_990_000 }],
        });
        expect(res.error).toBeNull();
        expect(res.signCalls).toHaveLength(1);
    });
});
