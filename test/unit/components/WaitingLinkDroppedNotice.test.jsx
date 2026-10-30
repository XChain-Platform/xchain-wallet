// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A payment link dropped while it waited behind an approved payment is
// reported as a dismissible notice on the screen the user went to, never as a
// toast. Both shells mount it first in the shell's notices slot.

import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { useWaitingLinkDropped } from '../../../packages/core/src/shared/components/WaitingLinkDroppedNotice.jsx';

const TEXT = 'The waiting payment link was dropped.';

afterEach(() => cleanup());

function Host({ view, carries }) {
    const dropped = useWaitingLinkDropped(view, carries);
    return (
        <div>
            <button type="button" onClick={dropped.show}>drop</button>
            {dropped.node}
        </div>
    );
}

describe('useWaitingLinkDropped', () => {
    it('shows nothing until a drop is reported', () => {
        render(<Host view="home" />);
        expect(screen.queryByText(TEXT)).toBeNull();
    });

    it('shows the notice as a status message and dismisses it', () => {
        render(<Host view="home" />);
        fireEvent.click(screen.getByText('drop'));
        const notice = screen.getByTestId('waiting-link-dropped');
        expect(notice).toHaveTextContent(TEXT);
        expect(notice.getAttribute('role')).toBe('status');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
        expect(screen.queryByText(TEXT)).toBeNull();
    });

    it('clears when the user moves to another screen', () => {
        const { rerender } = render(<Host view="home" />);
        fireEvent.click(screen.getByText('drop'));
        expect(screen.getByText(TEXT)).toBeTruthy();
        rerender(<Host view="history" />);
        expect(screen.queryByText(TEXT)).toBeNull();
    });

    it('reports the screen the user is on when the drop lands in the same commit as the route change', () => {
        const { result, rerender } = renderHook(({ view }) => useWaitingLinkDropped(view), { initialProps: { view: 'send' } });
        rerender({ view: 'home' });
        act(() => { result.current.show(); });
        expect(result.current.node).not.toBeNull();
        rerender({ view: 'home' });
        expect(result.current.node).not.toBeNull();
    });

    it('moves with a route named in carries', () => {
        const { rerender } = render(<Host view="scan" carries={{ scan: 'send' }} />);
        fireEvent.click(screen.getByText('drop'));
        rerender(<Host view="send" carries={{ scan: 'send' }} />);
        expect(screen.getByText(TEXT)).toBeTruthy();
        rerender(<Host view="home" carries={{ scan: 'send' }} />);
        expect(screen.queryByText(TEXT)).toBeNull();
    });
});

describe('shell wiring', () => {
    const read = (p) => readFileSync(resolve(import.meta.dirname, '../../../packages', p), 'utf8');

    it.each(['web/src/App.jsx', 'desktop/renderer/App.jsx'])('%s mounts the notice first in the notices slot and raises no toast for it', (file) => {
        const src = read(file);
        expect(src).not.toMatch(/showToast\(\{ message: t\('shell\.waitingLinkDropped'\)/);
        const slot = src.slice(src.indexOf('notices={'));
        expect(slot.indexOf('{waitingLinkDropped.node}')).toBeGreaterThan(-1);
        expect(slot.indexOf('{waitingLinkDropped.node}')).toBeLessThan(slot.indexOf('<QueuedBroadcastBanner'));
    });

    it('the web scan path leaves the waiting link to the Send remount, which drops it with the notice', () => {
        const src = read('web/src/App.jsx');
        const scan = src.slice(src.indexOf('onClassified={(outcome) => {'));
        expect(scan.slice(0, scan.indexOf("setUnlockedView('send')"))).not.toContain('heldLinkRef.current = null');
    });

    it('the desktop shell carries the notice from the scan screen to Send', () => {
        expect(read('desktop/renderer/App.jsx')).toContain("useWaitingLinkDropped(unlockedView, { scan: 'send' })");
    });
});
