// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A chain whose descriptor does not declare RBF never gets an RBF-signalling
// transaction, whichever route reaches the encoder. The Send form and the
// stored setting clamp the flag too, but every core path that calls
// encoder.createTx must hold the cap on its own, so a caller that skips the
// form clamp still cannot arm replace-by-fee on Dogecoin.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/gatedSendGuard.js', () => ({
    prepareGatedSend: vi.fn(async () => null),
    getGatedGroupsForSend: vi.fn(async () => []),
}));

import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { buildSendPsbt } from '../../../packages/core/src/flows/buildSendPsbt.js';
import { buildActionPsbt } from '../../../packages/core/src/flows/buildActionPsbt.js';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const DOGE = { coin: 'dogecoin', networkKind: 'regtest', feeStrategy: { rbfSupported: false } };
const BTC = { coin: 'bitcoin', networkKind: 'regtest', feeStrategy: { rbfSupported: true } };
const FROM = { address: 'src-address', publicKey: '03dd4688', derivationPath: "m/44'/3'/0'/0/0" };

function sdkFor(createTx) {
    return {
        encoder: { createTx, broadcastTx: vi.fn(async () => ({})) },
        actions: { createAction: vi.fn(() => ({ actionString: 'ISSUE|0|NEWTICK|1000', action: 'ISSUE', version: 0 })) },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
}

function encoderStub() {
    return vi.fn(async () => ({ psbt: '70736274ff', encoding: 'OP_RETURN' }));
}

async function viaCompose(descriptor) {
    const createTx = encoderStub();
    const composed = await composeForConfirm({
        sdkRegistry: { get: () => sdkFor(createTx) },
        chainRegistry: { get: () => descriptor },
        vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
        chainId: 'chain',
        actionData: { action: 'ISSUE', params: { TICK: 'NEWTICK', SUPPLY: '1000' } },
        encoderOpts: { pubkey: FROM.publicKey, change: FROM.address, rbf: true },
        source: FROM.address,
    });
    return { sent: createTx.mock.calls[0][0], composed };
}

async function viaBuildSend(descriptor) {
    const createTx = encoderStub();
    await buildSendPsbt({
        chainRegistry: { get: () => descriptor },
        sdkRegistry: { get: () => sdkFor(createTx) },
        chainId: 'chain',
        from: FROM,
        to: 'dest-address',
        tick: 'PEPE',
        amount: '1',
        rbf: true,
    });
    return createTx.mock.calls[0][0];
}

async function viaBuildAction(descriptor) {
    const createTx = encoderStub();
    await buildActionPsbt({
        chainRegistry: { get: () => descriptor },
        sdkRegistry: { get: () => sdkFor(createTx) },
        chainId: 'chain',
        from: FROM,
        actionData: { action: 'ISSUE', params: { TICK: 'NEWTICK', SUPPLY: '1000' } },
        encoderOpts: { rbf: true },
    });
    return createTx.mock.calls[0][0];
}

async function viaAtomicSubmit(descriptor) {
    const createTx = encoderStub();
    await submitWithSigner({
        sdkRegistry: { get: () => sdkFor(createTx) },
        chainRegistry: { get: () => descriptor },
        chainId: 'chain',
        actionData: { action: 'ISSUE', params: { TICK: 'NEWTICK', SUPPLY: '1000' } },
        encoderOpts: { pubkey: FROM.publicKey, sourceAddress: FROM.address, change: FROM.address, rbf: true },
        signer: {
            kind: 'software',
            signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
        },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
    });
    return createTx.mock.calls[0][0];
}

describe('every encoder call caps rbf to the chain descriptor', () => {
    it('composeForConfirm builds and returns rbf:false on a chain without RBF', async () => {
        const { sent, composed } = await viaCompose(DOGE);
        expect(sent.rbf).toBe(false);
        // The returned options drive signing, so they must match the built bytes.
        expect(composed.encoderOpts.rbf).toBe(false);
    });

    it('composeForConfirm keeps rbf:true where the descriptor declares it', async () => {
        const { sent, composed } = await viaCompose(BTC);
        expect(sent.rbf).toBe(true);
        expect(composed.encoderOpts.rbf).toBe(true);
    });

    it('buildSendPsbt caps rbf on a chain without RBF and keeps it elsewhere', async () => {
        expect((await viaBuildSend(DOGE)).rbf).toBe(false);
        expect((await viaBuildSend(BTC)).rbf).toBe(true);
    });

    it('buildActionPsbt caps rbf on a chain without RBF and keeps it elsewhere', async () => {
        expect((await viaBuildAction(DOGE)).rbf).toBe(false);
        expect((await viaBuildAction(BTC)).rbf).toBe(true);
    });

    it('the atomic submit path caps rbf on a chain without RBF and keeps it elsewhere', async () => {
        expect((await viaAtomicSubmit(DOGE)).rbf).toBe(false);
        expect((await viaAtomicSubmit(BTC)).rbf).toBe(true);
    });
});
