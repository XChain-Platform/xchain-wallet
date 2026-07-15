// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../../packages/core/src/shared/keyboard/useKeyboardShortcuts.js';

afterEach(() => cleanup());

function Harness({ enabled = true, handlers }) {
    useKeyboardShortcuts({ enabled, handlers });
    // An input to exercise the editable-focus guard.
    return <input aria-label="field" />;
}

function setup(overrides = {}) {
    const handlers = { navigate: vi.fn(), lock: vi.fn(), openHelp: vi.fn(), ...overrides };
    render(<Harness handlers={handlers} enabled={overrides.enabled ?? true} />);
    return handlers;
}

const press = (init) => fireEvent.keyDown(document.body, init);

describe('useKeyboardShortcuts', () => {
    it('fires modifier combos anywhere: Cmd/Ctrl+L locks, Cmd/Ctrl+, opens settings', () => {
        const h = setup();
        press({ key: 'l', ctrlKey: true });
        expect(h.lock).toHaveBeenCalledOnce();
        press({ key: ',', metaKey: true });
        expect(h.navigate).toHaveBeenCalledWith('settings');
    });

    it('Cmd/Ctrl+N maps to a new send', () => {
        const h = setup();
        press({ key: 'n', ctrlKey: true });
        expect(h.navigate).toHaveBeenCalledWith('send');
    });

    it('does NOT handle Cmd/Ctrl+K (owned by the command palette)', () => {
        const h = setup();
        press({ key: 'k', metaKey: true });
        expect(h.navigate).not.toHaveBeenCalled();
        expect(h.lock).not.toHaveBeenCalled();
        expect(h.openHelp).not.toHaveBeenCalled();
    });

    it('runs the g-leader navigation: g then h -> history, g then c -> contacts', () => {
        const h = setup();
        press({ key: 'g' });
        press({ key: 'h' });
        expect(h.navigate).toHaveBeenCalledWith('history');
        press({ key: 'g' });
        press({ key: 'c' });
        expect(h.navigate).toHaveBeenCalledWith('contacts');
    });

    it('a lone g followed by an unmapped key navigates nowhere', () => {
        const h = setup();
        press({ key: 'g' });
        press({ key: 'z' });
        expect(h.navigate).not.toHaveBeenCalled();
    });

    it('opens help on ? when nothing editable is focused', () => {
        const h = setup();
        press({ key: '?' });
        expect(h.openHelp).toHaveBeenCalledOnce();
    });

    it('suppresses single-key + leader shortcuts while an input is focused', () => {
        const h = setup();
        const input = screen.getByLabelText('field');
        input.focus();
        fireEvent.keyDown(input, { key: '?' });
        fireEvent.keyDown(input, { key: 'g' });
        fireEvent.keyDown(input, { key: 'h' });
        expect(h.openHelp).not.toHaveBeenCalled();
        expect(h.navigate).not.toHaveBeenCalled();
    });

    it('still fires modifier combos even while typing in an input', () => {
        const h = setup();
        const input = screen.getByLabelText('field');
        input.focus();
        fireEvent.keyDown(input, { key: 'l', metaKey: true });
        expect(h.lock).toHaveBeenCalledOnce();
    });

    it('honors §34.1 overrides: the rebound key fires, the default goes dead', () => {
        const handlers = { navigate: vi.fn(), lock: vi.fn(), openHelp: vi.fn() };
        function Rebound() {
            useKeyboardShortcuts({ enabled: true, overrides: { lock: 'mod+j' }, handlers });
            return null;
        }
        render(<Rebound />);
        press({ key: 'l', ctrlKey: true });
        expect(handlers.lock).not.toHaveBeenCalled();
        press({ key: 'j', ctrlKey: true });
        expect(handlers.lock).toHaveBeenCalledOnce();
    });

    it('does nothing when disabled', () => {
        const h = setup({ enabled: false });
        press({ key: 'l', ctrlKey: true });
        press({ key: '?' });
        press({ key: 'g' });
        press({ key: 'h' });
        expect(h.lock).not.toHaveBeenCalled();
        expect(h.openHelp).not.toHaveBeenCalled();
        expect(h.navigate).not.toHaveBeenCalled();
    });
});
