// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Focus trap + background-inert (§5.1).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useFocusTrap, useInertBackground } from '../../../packages/core/src/shared/utils/focusTrap.js';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';

afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    document.documentElement.classList.remove('xc-focus-visible-fallback');
});

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

function StackedInertHarness({ under = true, over = true }) {
    return (
        <>
            <button data-testid="stack-background">background</button>
            {under ? <NoticeModal key="under" title="Same title" onClose={() => {}} /> : null}
            {over ? <NoticeModal key="over" title="Same title" onClose={() => {}} /> : null}
        </>
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

    it('keeps only the top dialog active and restores shared background state', () => {
        const view = render(<StackedInertHarness />);
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        const labelIds = dialogs.map((dialog) => dialog.getAttribute('aria-labelledby'));
        expect(new Set(labelIds).size).toBe(2);
        expect(dialogs[0]).toHaveAttribute('inert');
        expect(dialogs[1]).not.toHaveAttribute('inert');

        view.rerender(<StackedInertHarness under={false} />);
        expect(screen.getByTestId('stack-background')).toHaveAttribute('inert');
        expect(screen.getByRole('dialog')).not.toHaveAttribute('inert');

        view.rerender(<StackedInertHarness under={false} over={false} />);
        expect(screen.getByTestId('stack-background')).not.toHaveAttribute('inert');
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
                    <button
                        data-testid="inside"
                        autoFocus={autoFocusInside}
                        onClick={() => setOpen(false)}
                        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
                    >close</button>
                </div>
            ) : null}
        </div>
    );
}

function RemovedOpenerHarness() {
    const [open, setOpen] = useState(false);
    const [finished, setFinished] = useState(false);
    const ref = useRef(null);
    useFocusTrap(ref, { active: open });
    if (finished) {
        return <main><h1>Destination</h1></main>;
    }
    return (
        <div>
            <button data-testid="removed-opener" onClick={() => setOpen(true)}>open</button>
            {open ? (
                <div ref={ref} role="dialog">
                    <button onClick={() => { setOpen(false); setFinished(true); }}>continue</button>
                </div>
            ) : null}
        </div>
    );
}

function FocusLayer({ name, onClose, children }) {
    const ref = useRef(null);
    useFocusTrap(ref, { active: true });
    return (
        <div ref={ref} role="dialog" aria-label={name}>
            {children}
            <button data-testid={`close-${name}`} onClick={onClose}>close {name}</button>
        </div>
    );
}

function StackedFocusHarness() {
    const [outerOpen, setOuterOpen] = useState(false);
    const [innerOpen, setInnerOpen] = useState(false);
    return (
        <div>
            <button data-testid="page-opener" onClick={() => setOuterOpen(true)}>open outer</button>
            {outerOpen ? (
                <FocusLayer name="outer" onClose={() => setOuterOpen(false)}>
                    <button data-testid="inner-opener" onClick={() => setInnerOpen(true)}>open inner</button>
                    {innerOpen ? (
                        <FocusLayer name="inner" onClose={() => setInnerOpen(false)} />
                    ) : null}
                </FocusLayer>
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

    it.each([
        ['pointer', 'pointerDown'],
        ['touch', 'touchStart'],
    ])('clears fallback keyboard modality before %s focus restore', async (_modality, startEvent) => {
        render(<OpenerHarness />);
        const opener = screen.getByTestId('opener');
        opener.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.documentElement).toHaveClass('xc-focus-visible-fallback');

        fireEvent.click(opener);
        await flush();
        const close = screen.getByTestId('inside');
        fireEvent[startEvent](close);
        fireEvent.click(close);
        await flush();

        expect(document.activeElement).toBe(opener);
        expect(document.documentElement).not.toHaveClass('xc-focus-visible-fallback');
    });

    it('keeps fallback keyboard modality for keyboard focus restore', async () => {
        render(<OpenerHarness />);
        const opener = screen.getByTestId('opener');
        opener.focus();
        fireEvent.click(opener);
        await flush();

        fireEvent.keyDown(screen.getByTestId('inside'), { key: 'Escape' });
        await flush();

        expect(document.activeElement).toBe(opener);
        expect(document.documentElement).toHaveClass('xc-focus-visible-fallback');
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

    it('focuses the destination heading when the opener is removed on close', async () => {
        render(<RemovedOpenerHarness />);
        const opener = screen.getByTestId('removed-opener');
        opener.focus();
        fireEvent.click(opener);
        await flush();

        fireEvent.click(screen.getByRole('button', { name: 'continue' }));
        await flush();

        const heading = screen.getByRole('heading', { name: 'Destination' });
        expect(heading).toHaveFocus();
        expect(heading).toHaveAttribute('tabindex', '-1');
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

    it('keeps one scroll lock and restores focus through stacked dialogs', async () => {
        document.body.style.overflow = 'auto';
        const styleChanges = [];
        const observer = new MutationObserver((records) => styleChanges.push(...records));
        observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
        render(<StackedFocusHarness />);
        const pageOpener = screen.getByTestId('page-opener');
        pageOpener.focus();
        fireEvent.click(pageOpener);
        await flush();
        expect(document.body.style.overflow).toBe('hidden');

        const innerOpener = screen.getByTestId('inner-opener');
        fireEvent.click(innerOpener);
        await flush();
        fireEvent.click(screen.getByTestId('close-inner'));
        await flush();
        expect(document.body.style.overflow).toBe('hidden');
        expect(document.activeElement).toBe(innerOpener);

        fireEvent.click(screen.getByTestId('close-outer'));
        await flush();
        expect(document.body.style.overflow).toBe('auto');
        expect(document.activeElement).toBe(pageOpener);
        expect(styleChanges).toHaveLength(2);
        observer.disconnect();
    });
});
