// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { listLabel, pickedListText } from '../../../packages/core/src/shared/utils/listLabel.js';

describe('pickedListText', () => {
    it('is null for an empty field, so the field reads None set', () => {
        expect(pickedListText('', null)).toBeNull();
        expect(pickedListText(undefined, { index: '7', name: 'x' })).toBeNull();
    });

    it('shows the name while the pick still describes the index', () => {
        expect(pickedListText('7', { index: '7', name: 'Team wallets' })).toBe('Team wallets (List #7)');
    });

    it('reads List #N for an unnamed list or an index the pick does not describe', () => {
        expect(pickedListText('7', { index: '7', name: undefined })).toBe('List #7');
        expect(pickedListText('8', { index: '7', name: 'Team wallets' })).toBe('List #8');
        expect(pickedListText(9, null)).toBe('List #9');
    });
});

describe('listLabel', () => {
    it('includes a plain list name', () => {
        expect(listLabel(42, 'Treasury wallets')).toBe('Treasury wallets (List #42)');
    });

    it('uses the list number when no name is provided', () => {
        expect(listLabel(42)).toBe('List #42');
    });

    it('uses the list number when the name is empty', () => {
        expect(listLabel(42, '')).toBe('List #42');
    });

    it('neutralizes bidi overrides in the name', () => {
        expect(listLabel(42, 'Treasury\u202Eevil')).toBe('Treasury␦evil (List #42)');
    });

    it('keeps named labels generic and supports a kind-specific fallback', () => {
        expect(listLabel(42, 'Treasury wallets', 'Token list'))
            .toBe('Treasury wallets (List #42)');
        expect(listLabel(42, null, 'Address list')).toBe('Address list #42');
    });
});
