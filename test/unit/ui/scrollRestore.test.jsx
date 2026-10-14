// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Back restores a list's offset only once the list is tall enough. jsdom
// neither lays out nor clamps scrollTop, so these tests give the scroller a
// content height they control and clamp writes to it the way a browser does,
// and drive a stand-in ResizeObserver when the content "grows".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Screen, ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';
import {
    describeFocusTarget,
    findFocusTarget,
    restoreScrollView,
} from '../../../packages/core/src/ui/scrollRestore.js';

const VIEW_HEIGHT = 600;
const observers = new Set();

class FakeResizeObserver {
    constructor(callback) {
        this.callback = callback;
        observers.add(this);
    }

    observe() {}

    disconnect() { observers.delete(this); }
}

/** Gives `el` a content height and clamps scrollTop to it like a browser. */
function clampScroller(el, contentHeight) {
    let height = contentHeight;
    let top = 0;
    const max = () => Math.max(0, height - VIEW_HEIGHT);
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value) => { top = Math.min(Math.max(0, value), max()); },
    });
    return {
        grow(next) {
            height = next;
            for (const observer of [...observers]) observer.callback([]);
        },
    };
}

function Rows({ count, prefix = 'tx' }) {
    return (
        <>
            <input aria-label="Search history" />
            <ul>
                {Array.from({ length: count }, (_, i) => (
                    <li key={i} data-history-key={`${prefix}-${i}`}>
                        <button type="button" data-history-row>Row {i}</button>
                    </li>
                ))}
            </ul>
        </>
    );
}

function Shell({ route, rows = 0 }) {
    return (
        <ScrollRestoration routeKey={route}>
            <Screen header={<h1 tabIndex={-1}>{route}</h1>}>
                {route === 'history' ? <Rows count={rows} /> : <p>{route}</p>}
            </Screen>
        </ScrollRestoration>
    );
}

const main = () => screen.getByRole('main');

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    window.ResizeObserver = FakeResizeObserver;
});

afterEach(() => {
    cleanup();
    observers.clear();
    vi.unstubAllGlobals();
    delete window.ResizeObserver;
});

/** Scrolls History to 1820, opens row 30, and comes Back to a list still loading. */
function leaveAndReturn() {
    const view = render(<Shell route="history" rows={60} />);
    const scroller = clampScroller(main(), 4000);
    main().scrollTop = 1820;
    fireEvent.scroll(main());
    const row = screen.getByRole('button', { name: 'Row 30' });
    row.focus();
    fireEvent.click(row);

    view.rerender(<Shell route="detail" />);
    expect(main().scrollTop).toBe(0);

    // Back: the list mounts before its rows have loaded, so only part of
    // its height is there yet.
    scroller.grow(VIEW_HEIGHT + 822);
    view.rerender(<Shell route="history" rows={0} />);
    return { view, scroller };
}

describe('Screen scroll restore on return', () => {
    it('waits for the content to grow, then lands on the saved offset and the opened row', async () => {
        const { view, scroller } = leaveAndReturn();
        // Clamped to what has rendered so far, as the bug left it.
        expect(main().scrollTop).toBe(822);

        view.rerender(<Shell route="history" rows={60} />);
        scroller.grow(4000);

        await waitFor(() => expect(main().scrollTop).toBe(1820));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Row 30' })).toHaveFocus());
    });

    it('never jumps once the user has scrolled', async () => {
        const { view, scroller } = leaveAndReturn();
        fireEvent.wheel(main(), { deltaY: 120 });
        main().scrollTop = 700;
        fireEvent.scroll(main());

        view.rerender(<Shell route="history" rows={60} />);
        scroller.grow(4000);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(main().scrollTop).toBe(700);
        expect(screen.getByRole('button', { name: 'Row 30' })).not.toHaveFocus();
    });

    it('keeps the saved offset when the user leaves before the list loads', async () => {
        const { view, scroller } = leaveAndReturn();
        view.rerender(<Shell route="detail" />);
        scroller.grow(700);

        view.rerender(<Shell route="history" rows={60} />);
        scroller.grow(4000);
        await waitFor(() => expect(main().scrollTop).toBe(1820));
    });

    it('leaves focus alone when the user already focused something on the page', async () => {
        const { view, scroller } = leaveAndReturn();
        view.rerender(<Shell route="history" rows={60} />);
        screen.getByRole('textbox', { name: 'Search history' }).focus();
        scroller.grow(4000);

        await waitFor(() => expect(main().scrollTop).toBe(1820));
        expect(screen.getByRole('textbox', { name: 'Search history' })).toHaveFocus();
    });
});

describe('restoreScrollView', () => {
    it('gives up after the bounded wait and never writes later', async () => {
        const el = document.createElement('div');
        document.body.append(el);
        const scroller = clampScroller(el, 900);
        const settled = vi.fn();

        const restore = restoreScrollView(el, { top: 1820 }, { waitMs: 20, onSettle: settled });
        expect(el.scrollTop).toBe(300);
        expect(restore.pending()).toBe(true);

        await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
        expect(restore.pending()).toBe(false);
        scroller.grow(4000);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(el.scrollTop).toBe(300);
        el.remove();
    });

    it('stops at the first key press', async () => {
        const el = document.createElement('div');
        document.body.append(el);
        const scroller = clampScroller(el, 900);
        const restore = restoreScrollView(el, { top: 1820 });

        fireEvent.keyDown(document.body, { key: 'Shift' });
        expect(restore.pending()).toBe(true);
        fireEvent.keyDown(document.body, { key: 'PageDown' });
        expect(restore.pending()).toBe(false);
        scroller.grow(4000);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(el.scrollTop).toBe(300);
        el.remove();
    });
});

describe('describeFocusTarget and findFocusTarget', () => {
    it('finds a keyed row again even when its text changed', () => {
        const el = document.createElement('div');
        el.innerHTML = '<ul><li data-history-key="btc:7"><button>5 min ago</button></li></ul>';
        const target = describeFocusTarget(el.querySelector('button'), el);
        el.innerHTML = '<ul><li data-history-key="btc:9"><button>1 min ago</button></li>'
            + '<li data-history-key="btc:7"><button>6 min ago</button></li></ul>';
        expect(findFocusTarget(target, el)?.textContent).toBe('6 min ago');
    });

    it('finds an unkeyed control by its name and position among same-named peers', () => {
        const el = document.createElement('div');
        el.innerHTML = '<button aria-label="Edit">a</button><button>Privacy</button><button aria-label="Edit">b</button>';
        const target = describeFocusTarget(el.querySelectorAll('button')[2], el);
        el.innerHTML = '<p>loading</p><button aria-label="Edit">a</button><button aria-label="Edit">b</button>';
        expect(findFocusTarget(target, el)?.textContent).toBe('b');
    });

    it('describes nothing outside the scroller or off any control', () => {
        const el = document.createElement('div');
        el.innerHTML = '<p>text</p>';
        expect(describeFocusTarget(el.querySelector('p'), el)).toBeNull();
        expect(describeFocusTarget(document.createElement('button'), el)).toBeNull();
    });
});
