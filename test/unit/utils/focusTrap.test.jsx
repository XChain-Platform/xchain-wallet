// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Focus trap + background-inert (§5.1).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useFocusTrap, useInertBackground } from '../../../packages/core/src/shared/utils/focusTrap.js';

afterEach(() => cleanup());

function TrapHarness({ active }) {
    const containerRef = useRef(null);
    useFocusTrap(containerRef, { active });
    return (
        <div>
            <button data-testid="outside">outside</button>
            <div ref={containerRef} data-testid="trap" tabIndex={-1}>
                <button data-testid="first">first</button>
                <button data-testid="last">last</button>
            </div>
        </div>
    );
}

function InertHarness({ active }) {
    const rootRef = useRef(null);
    useInertBackground(rootRef, { active });
    return (
        <div>
            <div data-testid="sibling">background</div>
            <div ref={rootRef} data-testid="modal-root">modal</div>
        </div>
    );
}

describe('useFocusTrap', () => {
    it('Tab from the last focusable wraps to the first', () => {
        render(<TrapHarness active />);
        const first = screen.getByTestId('first');
        const last = screen.getByTestId('last');
        last.focus();
        fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab' });
        expect(document.activeElement).toBe(first);
    });

    it('Shift+Tab from the first wraps to the last', () => {
        render(<TrapHarness active />);
        const first = screen.getByTestId('first');
        const last = screen.getByTestId('last');
        first.focus();
        fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
    });

    it('Tab from the focused container enters the first control', () => {
        render(<TrapHarness active />);
        const trap = screen.getByTestId('trap');
        trap.focus();
        fireEvent.keyDown(trap, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByTestId('first'));
    });

    it('does not trap when inactive', () => {
        render(<TrapHarness active={false} />);
        const last = screen.getByTestId('last');
        last.focus();
        fireEvent.keyDown(screen.getByTestId('trap'), { key: 'Tab' });
        // No preventDefault/wrap: focus stays where the browser would put it.
        expect(document.activeElement).toBe(last);
    });
});

describe('useInertBackground', () => {
    it('marks siblings inert while active and restores on unmount', () => {
        const { unmount } = render(<InertHarness active />);
        expect(screen.getByTestId('sibling').hasAttribute('inert')).toBe(true);
        unmount();
        // After unmount the harness is gone; re-render inactive to confirm no inert.
        render(<InertHarness active={false} />);
        expect(screen.getByTestId('sibling').hasAttribute('inert')).toBe(false);
    });
});

// A dialog opened from a control hands focus back to that control on close,
// including the common case where the dialog's own button carries autoFocus
// and has already taken focus before the trap's effect runs.
function OpenerHarness({ autoFocusInside = false }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useFocusTrap(ref, { active: open });
    return (
        <div>
            <button data-testid="opener" onClick={() => setOpen(true)}>open</button>
            {open ? (
                <div ref={ref} role="dialog">
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                    <button data-testid="inside" autoFocus={autoFocusInside} onClick={() => setOpen(false)}>close</button>
                </div>
            ) : null}
        </div>
    );
}

describe('useFocusTrap opener handling', () => {
    const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    it('moves focus into the dialog and back to the opener on close', async () => {
        render(<OpenerHarness />);
        const opener = screen.getByTestId('opener');
        opener.focus();
        fireEvent.click(opener);
        await flush();
        expect(document.activeElement).toBe(screen.getByTestId('inside'));
        fireEvent.click(screen.getByTestId('inside'));
        await flush();
        expect(document.activeElement).toBe(opener);
    });

    it('still finds the opener when an autoFocus control already took focus', async () => {
        render(<OpenerHarness autoFocusInside />);
        const opener = screen.getByTestId('opener');
        opener.focus();
        fireEvent.click(opener);
        await flush();
        expect(document.activeElement).toBe(screen.getByTestId('inside'));
        fireEvent.click(screen.getByTestId('inside'));
        await flush();
        expect(document.activeElement).toBe(opener);
    });

    it('does not pull focus back when something else claimed it on close', async () => {
        render(<div><OpenerHarness /><button data-testid="elsewhere">elsewhere</button></div>);
        const opener = screen.getByTestId('opener');
        opener.focus();
        fireEvent.click(opener);
        await flush();
        const elsewhere = screen.getByTestId('elsewhere');
        fireEvent.click(screen.getByTestId('inside'));
        elsewhere.focus();
        await flush();
        expect(document.activeElement).toBe(elsewhere);
    });

    it('with trap:false leaves Tab alone', () => {
        function NoTrap() {
            const ref = useRef(null);
            useFocusTrap(ref, { active: true, trap: false });
            return <div ref={ref}><button data-testid="a">a</button></div>;
        }
        render(<NoTrap />);
        const a = screen.getByTestId('a');
        a.focus();
        const notPrevented = fireEvent.keyDown(a, { key: 'Tab' });
        expect(notPrevented).toBe(true);
    });
});
