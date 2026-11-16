// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    orderPieces,
    planResend,
} from '../../../packages/core/src/flows/filePieceSequencer.js';

const txid = (name) => `tx-${name}`;

function uploadRecord(totalParts = 3) {
    const indexes = [-1, ...Array.from({ length: totalParts }, (_, index) => index)];
    return {
        stage: 'sending',
        fundingTxid: txid('funding'),
        fundingOutputs: indexes.map((index) => ({ index, unspent: true })),
        pieces: indexes.map((index) => ({
            index,
            signedTxids: [],
            txid: null,
            actionIndex: null,
        })),
        totalParts,
    };
}

function piece(record, index, changes) {
    Object.assign(record.pieces.find((entry) => entry.index === index), changes);
    return record;
}

function confirmed(record, index, actionIndex = null) {
    const id = txid(`piece-${index}`);
    piece(record, index, { signedTxids: [id], txid: id, actionIndex });
    return id;
}

describe('piece ordering', () => {
    it('puts funding first, every part in order, and the manifest last', () => {
        expect(orderPieces(3)).toEqual(['funding', 0, 1, 2, -1]);
    });

    it('keeps the 26-part order complete and gap-free', () => {
        const order = orderPieces(26);
        expect(order).toHaveLength(28);
        expect(order.slice(1, -1)).toEqual(Array.from({ length: 26 }, (_, index) => index));
        expect(order.at(-1)).toBe(-1);
    });
});

describe('a fresh upload', () => {
    it('sends funding and each part while deferring the manifest', () => {
        const record = uploadRecord();
        record.stage = 'funding';
        record.fundingTxid = null;

        expect(planResend({ record, chainStates: {} })).toEqual({
            funding: 'send',
            send: [0, 1, 2],
            skip: [],
            wait: [-1],
            blocked: null,
        });
    });
});

describe('a half-sent upload', () => {
    it('skips confirmed parts, waits for mempool parts, and sends untouched parts', () => {
        const record = uploadRecord();
        const mined = confirmed(record, 0);
        const pending = confirmed(record, 1);
        const states = {
            [record.fundingTxid]: 'confirmed',
            [mined]: 'confirmed',
            [pending]: 'mempool',
        };

        expect(planResend({ record, chainStates: states })).toEqual({
            funding: 'done',
            send: [2],
            skip: [0],
            wait: [1, -1],
            blocked: null,
        });
    });
});

describe('a dropped piece', () => {
    it('sends it again from its still-unspent funding output', () => {
        const record = uploadRecord();
        const states = { [record.fundingTxid]: 'confirmed' };
        for (const index of [0, 2]) states[confirmed(record, index, String(index))] = 'confirmed';
        const dropped = txid('dropped');
        piece(record, 1, { signedTxids: [dropped], txid: dropped });
        states[dropped] = 'dropped';

        expect(planResend({ record, chainStates: states })).toMatchObject({
            send: [1], skip: [0, 2], wait: [-1], blocked: null,
        });
    });
});

describe('a piece with unknown chain state', () => {
    it('waits instead of risking a duplicate send, then permits the manifest', () => {
        const record = uploadRecord();
        const states = { [record.fundingTxid]: 'confirmed' };
        for (const index of [0, 2]) states[confirmed(record, index, String(index))] = 'confirmed';
        const uncertain = txid('uncertain');
        piece(record, 1, { signedTxids: [uncertain], txid: uncertain });
        states[uncertain] = 'unknown';

        expect(planResend({ record, chainStates: states })).toMatchObject({
            send: [-1], skip: [0, 2], wait: [1], blocked: null,
        });
    });
});

describe('a spent funding output', () => {
    it('blocks a dropped piece and does not release the manifest', () => {
        const record = uploadRecord();
        const states = { [record.fundingTxid]: 'confirmed' };
        for (const index of [0, 2]) states[confirmed(record, index, String(index))] = 'confirmed';
        const dropped = txid('spent-output');
        piece(record, 1, { signedTxids: [dropped], txid: dropped });
        states[dropped] = 'dropped';
        record.fundingOutputs.find((output) => output.index === 1).unspent = false;

        expect(planResend({ record, chainStates: states })).toMatchObject({
            send: [], skip: [0, 2], wait: [1, -1], blocked: 'FUNDING_OUTPUT_SPENT',
        });
    });
});

describe('the 26-part case', () => {
    it('plans every untouched part without losing or duplicating an index', () => {
        const record = uploadRecord(26);
        const result = planResend({
            record,
            chainStates: new Map([[record.fundingTxid, 'confirmed']]),
        });

        expect(result.send).toEqual(Array.from({ length: 26 }, (_, index) => index));
        expect(result.wait).toEqual([-1]);
        expect(result.funding).toBe('done');
    });
});

describe('a complete upload', () => {
    it('skips every indexed piece including the manifest', () => {
        const record = uploadRecord();
        record.stage = 'complete';
        const states = { [record.fundingTxid]: 'confirmed' };
        for (const index of [-1, 0, 1, 2]) {
            states[confirmed(record, index, String(index))] = 'confirmed';
        }

        expect(planResend({ record, chainStates: states })).toEqual({
            funding: 'done',
            send: [],
            skip: [0, 1, 2, -1],
            wait: [],
            blocked: null,
        });
    });
});
