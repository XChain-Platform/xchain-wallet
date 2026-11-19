// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { legChainStatus } from '../../../packages/core/src/flows/deployLegWait.js';
import {
    readResumeChainState,
    RESUME_CHAIN_READ_INVALID,
} from '../../../packages/core/src/flows/multipartResumeChainRead.js';

const ADDRESS = 'resume-source';
const TX = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function recordFor(txid = TX, totalParts = 1) {
    const indexes = [-1, ...Array.from({ length: totalParts }, (_, index) => index)];
    return {
        fundingTxid: txid,
        fundingOutputs: indexes.map((index, vout) => ({ index, txid, vout, value: 1000 + vout })),
        pieces: indexes.map((index) => ({ index, signedTxids: [], txid: null })),
    };
}

function sdkFor({ block = null, utxos = [], unconfirmed = [] } = {}) {
    return {
        encoder: {
            getTxBlock: vi.fn(async () => block),
            getUTXOs: vi.fn(async () => ({ utxos })),
        },
        getUnconfirmed: vi.fn(async () => unconfirmed),
    };
}

function sdkWith(surfaces, values = {}) {
    const full = sdkFor(values);
    const sdk = {};
    if (surfaces.includes('block') || surfaces.includes('utxos')) sdk.encoder = {};
    if (surfaces.includes('block')) sdk.encoder.getTxBlock = full.encoder.getTxBlock;
    if (surfaces.includes('utxos')) sdk.encoder.getUTXOs = full.encoder.getUTXOs;
    if (surfaces.includes('unconfirmed')) sdk.getUnconfirmed = full.getUnconfirmed;
    return sdk;
}

async function readOne(sdk, record = recordFor()) {
    return readResumeChainState({ sdk, record, address: ADDRESS });
}

describe('transaction verdict parity', () => {
    const cases = [
        ['confirmed by block', () => sdkFor({ block: { block_height: 12 } })],
        ['confirmed by UTXO confirmations', () => sdkFor({ utxos: [{ txid: TX, confirmations: 1 }] })],
        ['mempool by UTXO list', () => sdkFor({ utxos: [{ txid: TX, confirmations: 0 }] })],
        ['mempool by unconfirmed rows', () => sdkFor({ unconfirmed: [{ tx_hash: TX }] })],
        ['dropped', () => sdkFor()],
        ['unknown after a throwing read', () => {
            const sdk = sdkFor();
            sdk.encoder.getTxBlock.mockRejectedValue(new Error('tracker unavailable'));
            return sdk;
        }],
        ['no read surface', () => ({})],
    ];

    it.each(cases)('%s equals legChainStatus on the same SDK', async (_label, makeSdk) => {
        const sdk = makeSdk();
        const expected = await legChainStatus({ sdk, txid: TX, address: ADDRESS });
        const result = await readOne(sdk);
        expect(result.chainStates[TX]).toBe(expected);
    });
});

describe('partial read surface parity', () => {
    const cases = [
        ['block only confirms', ['block'], { block: { block_height: 12 } }],
        ['block only cannot drop', ['block'], {}],
        ['UTXO only confirms', ['utxos'], { utxos: [{ txid: TX, confirmations: 1 }] }],
        ['UTXO only finds mempool', ['utxos'], { utxos: [{ txid: TX, confirmations: 0 }] }],
        ['UTXO only cannot drop', ['utxos'], {}],
        ['unconfirmed only finds mempool', ['unconfirmed'], { unconfirmed: [{ tx_hash: TX }] }],
        ['unconfirmed only cannot drop', ['unconfirmed'], {}],
        ['block and UTXO can drop', ['block', 'utxos'], {}],
        ['block and unconfirmed can drop', ['block', 'unconfirmed'], {}],
        ['address reads without block cannot drop', ['utxos', 'unconfirmed'], {}],
    ];

    it.each(cases)('%s exactly as legChainStatus does', async (_label, surfaces, values) => {
        const sdk = sdkWith(surfaces, values);
        const expected = await legChainStatus({ sdk, txid: TX, address: ADDRESS });
        const result = await readOne(sdk);
        expect(result.chainStates[TX]).toBe(expected);
    });
});

describe('distinct transaction reads', () => {
    it('reads a transaction held twice only once', async () => {
        const record = recordFor();
        record.pieces[0].signedTxids = [OTHER, OTHER];
        record.pieces[0].txid = OTHER;
        const sdk = sdkFor();

        const result = await readOne(sdk, record);

        expect(Object.keys(result.chainStates)).toEqual([TX, OTHER]);
        expect(sdk.encoder.getTxBlock).toHaveBeenCalledTimes(2);
        expect(sdk.encoder.getTxBlock.mock.calls.filter(([txid]) => txid === OTHER)).toHaveLength(1);
    });
});

describe('shared address reads', () => {
    it.each([2, 26])('reads each address surface once for a %i-part record', async (totalParts) => {
        const record = recordFor(TX, totalParts);
        record.pieces.forEach((piece, index) => {
            piece.signedTxids = [String(index + 1).padStart(64, '0')];
            piece.txid = piece.signedTxids[0];
        });
        const sdk = sdkFor();

        await readOne(sdk, record);

        expect(sdk.encoder.getUTXOs).toHaveBeenCalledTimes(1);
        expect(sdk.getUnconfirmed).toHaveBeenCalledTimes(1);
    });
});

describe('funding output liveness', () => {
    it('marks only a positively observed output unspent', async () => {
        const record = recordFor();
        const live = record.fundingOutputs[0];
        const sdk = sdkFor({ utxos: [{ txid: live.txid.toUpperCase(), vout: live.vout }] });

        const result = await readOne(sdk, record);

        expect(result.record.fundingOutputs.map((output) => output.unspent)).toEqual([true, false]);
    });

    it('marks every output spent or unknown when the UTXO read fails', async () => {
        const sdk = sdkFor();
        sdk.encoder.getUTXOs.mockRejectedValue(new Error('offline'));

        const result = await readOne(sdk);

        expect(result.record.fundingOutputs.every((output) => output.unspent === false)).toBe(true);
    });
});

describe('invalid resume reads', () => {
    it.each([
        ['record', { record: null, address: ADDRESS }],
        ['address', { record: recordFor(), address: '  ' }],
        ['fundingOutputs', { record: { ...recordFor(), fundingOutputs: {} }, address: ADDRESS }],
        ['pieces', { record: { ...recordFor(), pieces: {} }, address: ADDRESS }],
    ])('refuses an invalid %s', async (field, args) => {
        await expect(readResumeChainState({ sdk: {}, ...args })).rejects.toMatchObject({
            code: RESUME_CHAIN_READ_INVALID,
            message: expect.stringContaining(field),
        });
    });
});

describe('input ownership', () => {
    it('does not mutate the SDK input record or any nested entry', async () => {
        const record = recordFor();
        record.pieces[0].signedTxids = [OTHER];
        const before = structuredClone(record);

        const result = await readOne(sdkFor(), record);

        expect(record).toEqual(before);
        expect(result.record).not.toBe(record);
        expect(result.record.fundingOutputs[0]).not.toBe(record.fundingOutputs[0]);
    });
});
