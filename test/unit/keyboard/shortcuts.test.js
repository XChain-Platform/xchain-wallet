// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import {
    SHORTCUTS,
    SHORTCUT_GROUPS,
    isEditableTarget,
    parseBinding,
    formatBinding,
} from '../../../packages/core/src/shared/keyboard/shortcuts.js';

describe('SHORTCUTS table', () => {
    it('has unique ids and every entry belongs to a declared group', () => {
        const ids = new Set();
        for (const s of SHORTCUTS) {
            expect(ids.has(s.id)).toBe(false);
            ids.add(s.id);
            expect(SHORTCUT_GROUPS).toContain(s.group);
            expect(typeof s.label).toBe('string');
            expect(s.label.length).toBeGreaterThan(0);
        }
    });

    it('marks the command-palette entry as display-only (owned by useCommandPalette)', () => {
        const palette = SHORTCUTS.find((s) => s.id === 'command-palette');
        expect(palette.dispatch).toBe(false);
        // Everything else is dispatchable.
        for (const s of SHORTCUTS.filter((x) => x.id !== 'command-palette')) {
            expect(s.dispatch).toBe(true);
        }
    });
});

describe('parseBinding', () => {
    it('classifies combos, singles, and leaders', () => {
        expect(parseBinding('mod+k')).toEqual({ kind: 'combo', key: 'k' });
        expect(parseBinding('mod+,')).toEqual({ kind: 'combo', key: ',' });
        expect(parseBinding('?')).toEqual({ kind: 'single', key: '?' });
        expect(parseBinding('g h')).toEqual({ kind: 'leader', lead: 'g', key: 'h' });
    });
});

describe('formatBinding', () => {
    it('renders platform-appropriate combo glyphs', () => {
        expect(formatBinding('mod+l', false)).toBe('Ctrl+L');
        expect(formatBinding('mod+l', true)).toBe('⌘L');
        expect(formatBinding('mod+,', false)).toBe('Ctrl+,');
    });
    it('renders leaders and singles readably', () => {
        expect(formatBinding('g h')).toBe('G then H');
        expect(formatBinding('?')).toBe('?');
    });
});

describe('isEditableTarget', () => {
    it('is true for form fields, false otherwise', () => {
        const input = document.createElement('input');
        const textarea = document.createElement('textarea');
        const select = document.createElement('select');
        const div = document.createElement('div');
        expect(isEditableTarget(input)).toBe(true);
        expect(isEditableTarget(textarea)).toBe(true);
        expect(isEditableTarget(select)).toBe(true);
        expect(isEditableTarget(div)).toBe(false);
        expect(isEditableTarget(null)).toBe(false);
    });
});
