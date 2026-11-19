// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An in-app Back must not add a browser history entry. The browser steps back
// to the entry it already holds for the page Back returned to, so the
// browser's own Back next goes further back instead of reopening the page
// just left. These tests run on jsdom's real session history.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLastView } from '../../../packages/core/src/shared/hooks/useLastView.js';
import {
    afterHistorySettles,
    isInternalPop,
    registerBackHandler,
    resetBackStackForTests,
    stepHistoryBack,
} from '../../../packages/core/src/ui/backStack.js';

beforeEach(() => {
    resetBackStackForTests();
    // A marked entry, then the blank one the first route takes over, so the
    // entries each test writes sit right above the mark.
    window.history.pushState({ start: true }, '');
    window.history.pushState(null, '');
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    resetBackStackForTests();
});

const nextPop = () => new Promise((resolve) => { window.addEventListener('popstate', resolve, { once: true }); });

// `navBacks` counts the shell history's Back steps; every other route change
// in these tests keeps it, as opening a page does.
function renderShell(currentView, navBacks = 0) {
    const onResume = vi.fn();
    const onHistoryPop = vi.fn(() => false);
    const hook = renderHook(
        (props) => useLastView({
            walletId: 'wallet-1',
            network: 'mainnet',
            currentView: props.currentView,
            navBacks: props.navBacks,
            onResume,
            onHistoryPop,
        }),
        { initialProps: { currentView, navBacks } },
    );
    onResume.mockClear();
    return { ...hook, onResume, onHistoryPop };
}

describe('an in-app Back keeps the browser history in step', () => {
    it('steps back to the entry it wrote, so a browser Back next does not reopen the page left', async () => {
        const { rerender, onResume } = renderShell('history');
        rerender({ currentView: 'contacts', navBacks: 0 });
        expect(window.history.state.xcRoute.view).toBe('contacts');
        const length = window.history.length;

        const stepped = nextPop();
        rerender({ currentView: 'history', navBacks: 1 });
        await act(async () => { await stepped; });

        expect(window.history.state.xcRoute.view).toBe('history');
        // No entry was added; the page left is only Forward now.
        expect(window.history.length).toBe(length);
        expect(onResume).not.toHaveBeenCalled();

        const browserBack = nextPop();
        window.history.back();
        await act(async () => { await browserBack; });

        expect(window.history.state).toEqual({ start: true });
        expect(onResume).not.toHaveBeenCalled();
    });

    it('steps back over several entries when a finished form unwinds to a page it came through', async () => {
        const { rerender } = renderShell('history');
        rerender({ currentView: 'contacts', navBacks: 0 });
        rerender({ currentView: 'addresses', navBacks: 0 });
        const length = window.history.length;

        const stepped = nextPop();
        rerender({ currentView: 'history', navBacks: 1 });
        await act(async () => { await stepped; });

        expect(window.history.state.xcRoute.view).toBe('history');
        expect(window.history.length).toBe(length);
    });

    it('gives the page left its slot when the browser holds no entry for the page Back returned to', () => {
        // After a reload the shell history starts over above entries this
        // page never wrote.
        const { rerender } = renderShell('contacts');
        const length = window.history.length;
        const back = vi.spyOn(window.history, 'back');

        rerender({ currentView: 'history', navBacks: 1 });

        expect(back).not.toHaveBeenCalled();
        expect(window.history.length).toBe(length);
        expect(window.history.state.xcRoute.view).toBe('history');
    });

    it('still adds an entry for every page opened, Home and tab roots included', () => {
        const { rerender } = renderShell('history');
        const length = window.history.length;
        const back = vi.spyOn(window.history, 'back');
        const go = vi.spyOn(window.history, 'go');
        rerender({ currentView: 'contacts', navBacks: 0 });
        rerender({ currentView: 'addresses', navBacks: 0 });
        // Home starts the shell history over, but it is a page opened, not a
        // Back, so the browser keeps the pages before it.
        rerender({ currentView: 'home', navBacks: 0 });
        rerender({ currentView: 'history', navBacks: 0 });
        expect(window.history.length).toBe(length + 4);
        expect(back).not.toHaveBeenCalled();
        expect(go).not.toHaveBeenCalled();
    });

    it('follows a browser Back, so a later in-app Back steps from the entry shown', async () => {
        const { rerender } = renderShell('history');
        rerender({ currentView: 'contacts', navBacks: 0 });
        rerender({ currentView: 'addresses', navBacks: 0 });

        // The user's own Back to Contacts; the shell follows it.
        const browserBack = nextPop();
        window.history.back();
        await act(async () => { await browserBack; });
        rerender({ currentView: 'contacts', navBacks: 0 });
        expect(window.history.state.xcRoute.view).toBe('contacts');
        const length = window.history.length;

        const stepped = nextPop();
        rerender({ currentView: 'history', navBacks: 1 });
        await act(async () => { await stepped; });

        expect(window.history.state.xcRoute.view).toBe('history');
        expect(window.history.length).toBe(length);
    });

    it('still steps after a browser Back that only closed an overlay', async () => {
        const { rerender } = renderShell('history');
        rerender({ currentView: 'contacts', navBacks: 0 });

        // An overlay pushes its sentinel; the user's Back takes it off and
        // lands on the Contacts entry again.
        let unregister = null;
        unregister = registerBackHandler(() => { unregister?.(); }, 'overlay');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(window.history.state?.xcBack).toBe(true);
        const closed = nextPop();
        window.history.back();
        await act(async () => { await closed; });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(window.history.state.xcRoute.view).toBe('contacts');
        const length = window.history.length;

        const stepped = nextPop();
        rerender({ currentView: 'history', navBacks: 1 });
        await act(async () => { await stepped; });

        expect(window.history.state.xcRoute.view).toBe('history');
        expect(window.history.length).toBe(length);
    });

    it('takes a second Back pressed before the first one landed from where the first landed', async () => {
        const { rerender } = renderShell('history');
        rerender({ currentView: 'contacts', navBacks: 0 });
        rerender({ currentView: 'addresses', navBacks: 0 });
        const length = window.history.length;

        const landed = new Promise((resolve) => {
            let pops = 0;
            const onPop = () => {
                pops += 1;
                if (pops < 2) return;
                window.removeEventListener('popstate', onPop);
                resolve();
            };
            window.addEventListener('popstate', onPop);
        });
        rerender({ currentView: 'contacts', navBacks: 1 });
        rerender({ currentView: 'history', navBacks: 2 });
        await act(async () => { await landed; });

        expect(window.history.state.xcRoute.view).toBe('history');
        expect(window.history.length).toBe(length);

        const browserBack = nextPop();
        window.history.back();
        await act(async () => { await browserBack; });
        expect(window.history.state).toEqual({ start: true });
    });
});

describe('stepHistoryBack', () => {
    it('marks the pop it causes as internal', async () => {
        window.history.pushState({ page: 2 }, '');
        const popped = nextPop();
        expect(stepHistoryBack()).toBe(true);
        const event = await popped;
        expect(isInternalPop(event)).toBe(true);
    });

    it('holds a history write until a Back of its own has landed', async () => {
        window.history.pushState({ page: 2 }, '');
        const popped = nextPop();
        const write = vi.fn(() => window.history.state);
        stepHistoryBack();
        afterHistorySettles(write);
        expect(write).not.toHaveBeenCalled();
        await popped;
        expect(write).toHaveBeenCalledTimes(1);
        // The write saw the entry the Back landed on, not the one it left.
        expect(write.mock.results[0].value).toBeNull();
        afterHistorySettles(write);
        expect(write).toHaveBeenCalledTimes(2);
    });

    it('refuses while an overlay sentinel is the current entry or a step is invalid', async () => {
        vi.useFakeTimers();
        try {
            const unregister = registerBackHandler(() => {}, 'overlay');
            act(() => { vi.runAllTimers(); });
            expect(window.history.state?.xcBack).toBe(true);
            expect(stepHistoryBack()).toBe(false);
            unregister();
        } finally {
            vi.useRealTimers();
        }
        resetBackStackForTests();
        expect(stepHistoryBack(0)).toBe(false);
        expect(stepHistoryBack(1.5)).toBe(false);
    });
});
