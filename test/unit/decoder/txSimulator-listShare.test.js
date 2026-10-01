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
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';

const permanentShareNote = 'Sharing is permanent. There is no unshare.';
const permanentTransferNote = 'This transfer cannot be undone.';

function listPreview(params) {
    return simulateAction({
        action: 'LIST',
        params,
        balances: [{ tick: 'BTC', amount: '1', isCoin: true }],
        feeEstimate: '0.0001',
    });
}

function expectPreview(result, value, notes = []) {
    expect(result.sideEffects).toEqual([{ kind: 'list', label: 'List', value }]);
    expect(result.notes).toEqual(notes);
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]).toMatchObject({
        tick: 'BTC',
        isFee: true,
        feeAmount: '0.0001',
    });
}

describe('simulateAction LIST share', () => {
    it('previews a permanent share', () => {
        expectPreview(
            listPreview({ VERSION: '2', LIST_ACTION_INDEX: '41' }),
            'Share list #41',
            [permanentShareNote],
        );
    });

    it('uses a question mark for an empty list index', () => {
        expectPreview(
            listPreview({ VERSION: '2', LIST_ACTION_INDEX: '' }),
            'Share list #?',
            [permanentShareNote],
        );
    });
});

describe('simulateAction LIST transfer', () => {
    it('renders a short destination as an address id', () => {
        expectPreview(
            listPreview({ VERSION: '3', LIST_ACTION_INDEX: '41', DESTINATION: '^902' }),
            'Transfer list #41 to address id 902',
            [permanentTransferNote],
        );
    });

    it('uses a question mark for an empty destination', () => {
        expectPreview(
            listPreview({ VERSION: '3', LIST_ACTION_INDEX: '41', DESTINATION: '' }),
            'Transfer list #41 to ?',
            [permanentTransferNote],
        );
    });
});

describe('simulateAction LIST union create', () => {
    it.each([
        [['41'], '1 member list'],
        [['41', '52', '63'], '3 member lists'],
    ])('previews %s as %s', (items, value) => {
        expectPreview(listPreview({ VERSION: '0', TYPE: '3', ITEM: items }), value);
    });
});

describe('simulateAction BATCH with LIST share', () => {
    it('keeps the share preview and emits one batch fee row', () => {
        const result = simulateAction({
            action: 'BATCH',
            params: {
                COMMANDS: [
                    { action: 'LIST', params: { VERSION: '2', LIST_ACTION_INDEX: '41' } },
                ],
            },
            balances: [{ tick: 'BTC', amount: '1', isCoin: true }],
            feeEstimate: '0.0001',
        });

        expectPreview(result, 'Share list #41', [permanentShareNote]);
    });
});
