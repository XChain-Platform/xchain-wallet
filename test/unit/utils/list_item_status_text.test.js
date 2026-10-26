// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    listItemStatusText,
    listStatusText,
    listStatusTitle,
} from '../../../packages/core/src/shared/utils/listItemStatusText.js';

describe('listItemStatusText', () => {
    it('maps each per-item list verdict to plain words', () => {
        expect(listItemStatusText('invalid: TICK (unknown)')).toBe('token not found');
        expect(listItemStatusText('invalid: TICK (format)')).toBe('not a valid token name');
        expect(listItemStatusText('invalid: ADDRESS (format)')).toBe('not a valid address for this network');
        expect(listItemStatusText('invalid: LIST (unknown)')).toBe('list not found');
        expect(listItemStatusText('invalid: LIST (type)')).toBe('list holds a different kind of item');
        expect(listItemStatusText('invalid: LIST (union)')).toBe('a combined list cannot hold another combined list');
    });

    it('returns null for an accepted item', () => {
        expect(listItemStatusText('valid')).toBeNull();
        expect(listItemStatusText(undefined)).toBeNull();
        expect(listItemStatusText('')).toBeNull();
    });

    it('never echoes an unrecognised verdict', () => {
        expect(listItemStatusText('invalid: SOMETHING (new)')).toBe('not accepted by the network');
    });
});

// Every LIST-level verdict the indexer emits today, from list.js and list/.
const LIST_CODES = [
    'invalid: VERSION (unknown)',
    'invalid: TYPE (unknown)',
    'invalid: EDIT (unknown)',
    'invalid: LIST_ACTION_INDEX (unknown)',
    'invalid: LIST_ACTION_INDEX (not owner)',
    'invalid: LIST_ACTION_INDEX (bridge-owned)',
    'invalid: LIST_ACTION_INDEX (type)',
    'invalid: LIST_ACTION_INDEX (already shared)',
    'invalid: LIST_ACTION_INDEX (list exceeds LIST_SHARE_MAX_MEMBERS)',
    'invalid: ITEM (no member list)',
    'invalid: ITEM (union exceeds LIST_UNION_MAX_MEMBERS)',
    'invalid: ITEM (union exceeds LIST_SHARE_MAX_MEMBERS)',
    'invalid: ITEM (shared list exceeds LIST_SHARE_MAX_MEMBERS)',
    'invalid: SOURCE (sleeping)',
    'invalid: NAME (no change)',
    'invalid: DESTINATION (unresolvable ^id)',
    'invalid: DESTINATION (format)',
    'invalid: MEMO (pipe)',
    'invalid: MEMO (semicolon)',
    'invalid: MEMO (length)',
    'invalid: NAME (format)',
    'invalid: DESCRIPTION (length)',
    'invalid: insufficient fee (native coin output required)',
    'invalid: insufficient funds (FEE)',
];

describe('listStatusText', () => {
    it('gives every list-level verdict its own plain phrase', () => {
        for (const code of LIST_CODES) {
            const text = listStatusText(code);
            expect(text, code).not.toBe('not accepted by the network');
            expect(text, code).not.toMatch(/invalid:|[A-Z]{2,}/);
        }
        expect(listStatusText('invalid: LIST_ACTION_INDEX (not owner)'))
            .toBe('sent by an address that does not own the list');
        expect(listStatusText('invalid: MEMO (length)')).toBe('the memo is too long');
        expect(listStatusText('invalid: insufficient funds (FEE)')).toBe('the fee was not paid');
    });

    it('reads valid and missing as nothing to explain, and pending as pending', () => {
        expect(listStatusText('valid')).toBeNull();
        expect(listStatusText(' Valid ')).toBeNull();
        expect(listStatusText(undefined)).toBeNull();
        expect(listStatusText('')).toBeNull();
        expect(listStatusText('pending')).toBe('pending');
    });

    it('never echoes an unrecognised list verdict', () => {
        expect(listStatusText('invalid: FOO (bar)')).toBe('not accepted by the network');
        expect(listStatusText('invalid: some new message')).toBe('not accepted by the network');
        expect(listStatusText('invalid: TICK (unknown)')).toBe('token not found');
    });
});

describe('listStatusTitle', () => {
    it('keeps the raw verdict for a tooltip with controls neutralized', () => {
        expect(listStatusTitle('invalid: TICK (unknown)')).toBe('invalid: TICK (unknown)');
        expect(listStatusTitle('invalid: x‮y')).toBe('invalid: x␦y');
        expect(listStatusTitle('valid')).toBeUndefined();
        expect(listStatusTitle(null)).toBeUndefined();
    });
});
