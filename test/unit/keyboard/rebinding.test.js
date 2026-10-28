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
    parseBinding,
    reservedChordLabel,
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

    it('leaves select-all and the clipboard combos to the platform', () => {
        for (const key of ['a', 'c', 'v', 'x']) {
            expect(isValidBinding(`mod+${key}`, 'combo'), key).toBe(false);
        }
        // A stored override on one of them falls back to the default.
        expect(resolveBindings({ lock: 'mod+c' }).find((s) => s.id === 'lock').binding).toBe('g l');
        expect(isValidBinding('mod+j', 'combo')).toBe(true);
    });

    it('refuses the combos the browser and desktop keep', () => {
        for (const key of ['w', 't', 'n', 'q', 'r', 'l', ',']) {
            expect(isValidBinding(`mod+${key}`, 'combo'), key).toBe(false);
        }
        expect(isValidBinding('mod+k', 'combo')).toBe(true);
        expect(isValidBinding('mod+/', 'combo')).toBe(true);
    });

    it('falls back to the default when a stored override sits on a reserved combo', () => {
        const resolved = resolveBindings({
            lock: 'mod+w',
            settings: 'mod+,',
            'new-send': 'mod+n',
            'command-palette': 'mod+t',
        });
        expect(resolved.find((s) => s.id === 'lock')).toMatchObject({ binding: 'g l', overridden: false });
        expect(resolved.find((s) => s.id === 'settings')).toMatchObject({ binding: 'g e', overridden: false });
        expect(resolved.find((s) => s.id === 'new-send')).toMatchObject({ binding: 'g n', overridden: false });
        expect(resolved.find((s) => s.id === 'command-palette')).toMatchObject({ binding: 'mod+k', overridden: false });
    });

    it('keeps a stored combo override that is not reserved', () => {
        const lock = resolveBindings({ lock: 'mod+j' }).find((s) => s.id === 'lock');
        expect(lock).toMatchObject({ binding: 'mod+j', overridden: true });
    });

    it('ships no default on a combo the browser keeps', () => {
        for (const s of SHORTCUTS) {
            for (const binding of [s.binding, s.altBinding].filter(Boolean)) {
                const p = parseBinding(binding);
                if (p.kind === 'combo') expect(`${s.id} ${binding}`).not.toMatch(/mod\+[wtnqrl,]$/);
            }
        }
    });

    it('names the reserved chord a keydown spells, shifted and F5 included', () => {
        expect(reservedChordLabel({ key: 'w', metaKey: true }, true)).toBe('Cmd+W');
        expect(reservedChordLabel({ key: ',', ctrlKey: true }, false)).toBe('Ctrl+,');
        expect(reservedChordLabel({ key: 'T', metaKey: true, shiftKey: true }, true)).toBe('Cmd+Shift+T');
        expect(reservedChordLabel({ key: 'N', ctrlKey: true, shiftKey: true }, false)).toBe('Ctrl+Shift+N');
        expect(reservedChordLabel({ key: 'F5' }, true)).toBe('F5');
        expect(reservedChordLabel({ key: 'k', metaKey: true }, true)).toBe(null);
        expect(reservedChordLabel({ key: 'w' }, true)).toBe(null);
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
            lock: 'x y',                 // combo -> leader: refused
            'history-export': 'x',       // not rebindable
            'go-send': 'not a binding',  // junk
            bogus: 'mod+z',              // unknown id
        });
        expect(resolved.find((s) => s.id === 'lock').binding).toBe('g l');
        expect(resolved.find((s) => s.id === 'history-export').binding).toBe('e');
        expect(resolved.find((s) => s.id === 'go-send').binding).toBe('g s');
    });
});

describe('findBindingConflict', () => {
    it('flags a collision with another effective binding', () => {
        expect(findBindingConflict('go-send', 'g l', null)).toBe('lock');
        // A rebound shortcut frees its default...
        const overrides = { lock: 'mod+j' };
        expect(findBindingConflict('go-send', 'g l', overrides)).toBe(null);
        // ...and occupies its new key.
        expect(findBindingConflict('new-send', 'mod+j', overrides)).toBe('lock');
    });

    it('never reports the shortcut against itself', () => {
        expect(findBindingConflict('lock', 'g l', null)).toBe(null);
    });

    it('flags a single key that a leader sequence starts on, in both directions', () => {
        // The dispatcher arms the g leader first, so help on g would never open.
        expect(findBindingConflict('shortcut-help', 'g', null)).toBe('lock');
        // A leader starting on Balances' h would arm while h hides a token.
        expect(findBindingConflict('go-history', 'h h', null)).toBe('balances-hide');
        expect(findBindingConflict('go-history', 'e x', null)).toBe('history-export');
        // A single key rebound away frees its letter for a leader.
        expect(findBindingConflict('go-history', 'x h', { 'shortcut-help': 'x' })).toBe('shortcut-help');
        expect(findBindingConflict('go-history', 't h', null)).toBe(null);
    });
});

describe('formatBinding named keys', () => {
    it('capitalizes named combo keys instead of shouting them', () => {
        expect(formatBinding('mod+enter', false)).toBe('Ctrl+Enter');
        expect(formatBinding('mod+enter', true)).toBe('Cmd+Enter');
        expect(formatBinding('mod+k', false)).toBe('Ctrl+K');
    });
});
