// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { multipartPanelProps } from '../../../packages/core/src/flows/multipartPanelProps.js';

const record = (overrides = {}) => ({
    stage: 'funding',
    totalParts: 4,
    pieces: [
        { index: -1, signedTxids: [], txid: '', actionIndex: null },
        ...Array.from({ length: 4 }, (_, index) => (
            { index, signedTxids: [], txid: '', actionIndex: null }
        )),
    ],
    ...overrides,
});

const captureError = (value) => {
    try {
        multipartPanelProps(value);
    } catch (error) {
        return error;
    }
    throw new Error('Expected multipartPanelProps to throw');
};

describe('multipartPanelProps progress mapping', () => {
    it('starts a fresh funding record at part one', () => {
        expect(multipartPanelProps(record())).toEqual({
            totalParts: 4, transactions: 11, currentPart: 1, stage: 'funding',
        });
    });

    it('maps a half-sent record from its persisted txids', () => {
        const input = record();
        input.stage = 'sending';
        input.pieces[1].txid = 'part-0';
        input.pieces[2].txid = 'part-1';
        expect(multipartPanelProps(input).currentPart).toBe(3);
    });

    it('caps progress when every part is sent and the manifest is unsent', () => {
        const input = record({ stage: 'sending' });
        input.pieces.slice(1).forEach((piece, index) => { piece.txid = `part-${index}`; });
        expect(multipartPanelProps(input).currentPart).toBe(4);
        expect(input.pieces[0].txid).toBe('');
    });

    it.each(['funding', 'sending', 'assembling', 'complete', 'mismatch'])(
        'passes through the %s stage',
        (stage) => {
            expect(multipartPanelProps(record({ stage })).stage).toBe(stage);
        },
    );

    it('maps 26 parts to 55 transactions', () => {
        const pieces = [{ index: -1 }, ...Array.from({ length: 26 }, (_, index) => ({ index }))];
        expect(multipartPanelProps(record({ totalParts: 26, pieces })).transactions).toBe(55);
    });

    it('does not count the manifest txid as a sent part', () => {
        const input = record();
        input.pieces[0].txid = 'manifest';
        expect(multipartPanelProps(input).currentPart).toBe(1);
    });
});

describe('multipartPanelProps record validation', () => {
    it.each([null, undefined])('rejects a nullish record', (value) => {
        const error = captureError(value);
        expect(error.code).toBe('FILE_PANEL_RECORD_INVALID');
        expect(error.message).toContain('record');
    });

    it.each([1, 2.5, 33])('rejects invalid totalParts %s', (totalParts) => {
        const error = captureError(record({ totalParts }));
        expect(error.code).toBe('FILE_PANEL_RECORD_INVALID');
        expect(error.message).toContain('totalParts');
    });

    it('rejects an unknown stage', () => {
        const error = captureError(record({ stage: 'waiting' }));
        expect(error.code).toBe('FILE_PANEL_RECORD_INVALID');
        expect(error.message).toContain('stage');
    });

    it.each([null, {}])('rejects a non-array pieces value', (pieces) => {
        const error = captureError(record({ pieces }));
        expect(error.code).toBe('FILE_PANEL_RECORD_INVALID');
        expect(error.message).toContain('pieces');
    });

    it.each([-2, 4, 0.5])('rejects invalid piece index %s', (index) => {
        const error = captureError(record({ pieces: [{ index }] }));
        expect(error.code).toBe('FILE_PANEL_RECORD_INVALID');
        expect(error.message).toContain('index');
    });
});

describe('multipartPanelProps input handling', () => {
    it('does not mutate the record or its pieces', () => {
        const input = record({ stage: 'mismatch' });
        input.pieces[1].txid = 'part-0';
        const before = structuredClone(input);
        multipartPanelProps(input);
        expect(input).toEqual(before);
    });
});
