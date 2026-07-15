// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34.2 per-screen shortcut dispatcher (History '/' + 'e', Send mod+enter,
// Balances p/h/o).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { useScreenShortcuts } from '../../../packages/core/src/shared/keyboard/useScreenShortcuts.js';

afterEach(() => cleanup());

function Harness({ enabled = true, keys }) {
    useScreenShortcuts({ enabled, keys });
    return <input aria-label="field" />;
}

const press = (init) => fireEvent.keyDown(document.body, init);

describe('useScreenShortcuts', () => {
    it('fires single keys when no editable element has focus', () => {
        const e = vi.fn();
        render(<Harness keys={{ e }} />);
        press({ key: 'e' });
        expect(e).toHaveBeenCalledOnce();
    });

    it('suppresses single keys while typing but lets combos through', () => {
        const e = vi.fn();
        const submit = vi.fn();
        render(<Harness keys={{ e, 'mod+enter': submit }} />);
        const field = screen.getByLabelText('field');
        field.focus();
        fireEvent.keyDown(field, { key: 'e' });
        expect(e).not.toHaveBeenCalled();
        fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
        expect(submit).toHaveBeenCalledOnce();
    });

    it('a handler returning false declines the key (no preventDefault)', () => {
        const p = vi.fn(() => false);
        render(<Harness keys={{ p }} />);
        const evt = new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
        window.dispatchEvent(evt);
        expect(p).toHaveBeenCalledOnce();
        expect(evt.defaultPrevented).toBe(false);
    });

    it('is inert when disabled and ignores modified keys it does not own', () => {
        const e = vi.fn();
        const { rerender } = render(<Harness enabled={false} keys={{ e }} />);
        press({ key: 'e' });
        expect(e).not.toHaveBeenCalled();
        rerender(<Harness enabled keys={{ e }} />);
        press({ key: 'e', altKey: true });
        expect(e).not.toHaveBeenCalled();
        press({ key: 'e' });
        expect(e).toHaveBeenCalledOnce();
    });
});
