// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34.1 rebinding model: validation, override resolution, and conflict
// detection over the SHORTCUTS catalogue.

import { describe, it, expect } from 'vitest';
import {
    SHORTCUTS,
    isRebindable,
    isValidBinding,
    resolveBindings,
    findBindingConflict,
    formatBinding,
} from '../../../packages/core/src/shared/keyboard/shortcuts.js';

describe('isRebindable', () => {
    it('allows the dispatched set plus the palette combo, not context keys', () => {
        expect(isRebindable(SHORTCUTS.find((s) => s.id === 'lock'))).toBe(true);
        expect(isRebindable(SHORTCUTS.find((s) => s.id === 'command-palette'))).toBe(true);
        expect(isRebindable(SHORTCUTS.find((s) => s.id === 'history-export'))).toBe(false);
        expect(isRebindable(SHORTCUTS.find((s) => s.id === 'send-submit'))).toBe(false);
    });
});

describe('isValidBinding', () => {
    it('accepts each family and enforces the kind restriction', () => {
        expect(isValidBinding('mod+k', 'combo')).toBe(true);
        expect(isValidBinding('mod+enter', 'combo')).toBe(true);
        expect(isValidBinding('g h', 'leader')).toBe(true);
        expect(isValidBinding('?', 'single')).toBe(true);
        // Cross-family rebinds are refused.
        expect(isValidBinding('g h', 'combo')).toBe(false);
        expect(isValidBinding('mod+k', 'single')).toBe(false);
    });

    it('rejects junk', () => {
        expect(isValidBinding('', 'combo')).toBe(false);
        expect(isValidBinding('mod+', 'combo')).toBe(false);
        expect(isValidBinding('ctrl+k', 'combo')).toBe(false);
        expect(isValidBinding('g h j', 'leader')).toBe(false);
        expect(isValidBinding(42)).toBe(false);
    });
});

describe('resolveBindings', () => {
    it('returns defaults untouched with no overrides', () => {
        const resolved = resolveBindings(null);
        expect(resolved).toHaveLength(SHORTCUTS.length);
        for (const s of resolved) expect(s.overridden).toBe(false);
    });

    it('applies a valid override and drops the altBinding', () => {
        const resolved = resolveBindings({ 'shortcut-help': '.' });
        const help = resolved.find((s) => s.id === 'shortcut-help');
        expect(help.binding).toBe('.');
        expect(help.altBinding).toBeUndefined();
        expect(help.overridden).toBe(true);
    });

    it('ignores invalid, cross-family, and non-rebindable overrides', () => {
        const resolved = resolveBindings({
            lock: 'g l',                 // combo -> leader: refused
            'history-export': 'x',       // not rebindable
            'go-send': 'not a binding',  // junk
            bogus: 'mod+z',              // unknown id
        });
        expect(resolved.find((s) => s.id === 'lock').binding).toBe('mod+l');
        expect(resolved.find((s) => s.id === 'history-export').binding).toBe('e');
        expect(resolved.find((s) => s.id === 'go-send').binding).toBe('g s');
    });
});

describe('findBindingConflict', () => {
    it('flags a collision with another effective binding', () => {
        expect(findBindingConflict('new-send', 'mod+l', null)).toBe('lock');
        // A rebound shortcut frees its default...
        const overrides = { lock: 'mod+j' };
        expect(findBindingConflict('new-send', 'mod+l', overrides)).toBe(null);
        // ...and occupies its new key.
        expect(findBindingConflict('new-send', 'mod+j', overrides)).toBe('lock');
    });

    it('never reports the shortcut against itself', () => {
        expect(findBindingConflict('lock', 'mod+l', null)).toBe(null);
    });
});

describe('formatBinding named keys', () => {
    it('capitalizes named combo keys instead of shouting them', () => {
        expect(formatBinding('mod+enter', false)).toBe('Ctrl+Enter');
        expect(formatBinding('mod+enter', true)).toBe('⌘Enter');
        expect(formatBinding('mod+k', false)).toBe('Ctrl+K');
    });
});
