// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Android Back key left the wallet from every inner screen (LG K51,
// 2026-10-12), because a view-state SPA never grows the session history a
// Back press walks. These guards pin the one invariant that fixes it: a
// sentinel history entry is on top if and only if some screen has a back
// action, and popping it runs that screen's own back action.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { registerBackHandler, resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });
const armed = () => Boolean(window.history.state && window.history.state.xcBack);
/** A system Back press: pop one history entry and let popstate land. */
async function pressBack() {
    window.history.back();
    await settle();
}

beforeEach(() => {
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

afterEach(async () => {
    cleanup();
    await settle();
    resetBackStackForTests();
    vi.restoreAllMocks();
});

describe('back stack', () => {
    it('leaves the history alone while nothing can go back', async () => {
        const push = vi.spyOn(window.history, 'pushState');
        render(<PageHeader title="Home" />);
        await settle();
        expect(push).not.toHaveBeenCalled();
        expect(armed()).toBe(false);
    });

    it('arms one sentinel when a screen has a back action, and Back runs it', async () => {
        const onBack = vi.fn();
        render(<PageHeader title="Receive" onBack={onBack} />);
        await settle();
        expect(armed()).toBe(true);

        await pressBack();
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('re-arms after a Back press when the screen can still go back', async () => {
        const onBack = vi.fn();
        render(<PageHeader title="Settings" onBack={onBack} />);
        await settle();
        await pressBack();
        expect(armed()).toBe(true);
        await pressBack();
        expect(onBack).toHaveBeenCalledTimes(2);
    });

    it('removes the sentinel when the user gets home by an on-screen control', async () => {
        const onBack = vi.fn();
        const view = render(<PageHeader title="Receive" onBack={onBack} />);
        await settle();
        view.rerender(<PageHeader title="Home" />);
        await settle();
        expect(armed()).toBe(false);
        // Taking our own sentinel back out is not a Back press.
        expect(onBack).not.toHaveBeenCalled();
    });

    it('does not touch the history when one back screen replaces another', async () => {
        const first = vi.fn();
        const second = vi.fn();
        const view = render(<PageHeader key="a" title="Menu" onBack={first} />);
        await settle();
        const push = vi.spyOn(window.history, 'pushState');
        const back = vi.spyOn(window.history, 'back');
        view.rerender(<PageHeader key="b" title="Addresses" onBack={second} />);
        await settle();
        expect(push).not.toHaveBeenCalled();
        expect(back).not.toHaveBeenCalled();

        back.mockRestore();
        await pressBack();
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });

    it('follows the newest onBack without re-registering on every render', async () => {
        const stale = vi.fn();
        const fresh = vi.fn();
        const view = render(<PageHeader title="Send" onBack={stale} />);
        await settle();
        const push = vi.spyOn(window.history, 'pushState');
        view.rerender(<PageHeader title="Send" onBack={fresh} />);
        await settle();
        expect(push).not.toHaveBeenCalled();
        await pressBack();
        expect(fresh).toHaveBeenCalledTimes(1);
        expect(stale).not.toHaveBeenCalled();
    });

    it('swallows a Back press while the back button is disabled', async () => {
        const onBack = vi.fn();
        render(<PageHeader title="Sending" onBack={onBack} backDisabled />);
        await settle();
        await pressBack();
        expect(onBack).not.toHaveBeenCalled();
        // Still armed: the next press is also ours, not an exit.
        expect(armed()).toBe(true);
    });

    it('runs the most recently registered handler', async () => {
        const under = vi.fn();
        const over = vi.fn();
        const offUnder = registerBackHandler(under);
        const offOver = registerBackHandler(over);
        await settle();
        await pressBack();
        expect(over).toHaveBeenCalledTimes(1);
        expect(under).not.toHaveBeenCalled();
        offOver();
        await settle();
        await pressBack();
        expect(under).toHaveBeenCalledTimes(1);
        offUnder();
    });

    it('sends Escape only to the top overlay', () => {
        const under = vi.fn();
        const over = vi.fn();
        const offUnder = registerBackHandler(under);
        const offOver = registerBackHandler(over);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(over).toHaveBeenCalledTimes(1);
        expect(under).not.toHaveBeenCalled();

        offOver();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(under).toHaveBeenCalledTimes(1);
        offUnder();
    });

    it('does not turn Escape into route navigation', () => {
        const overlayBack = vi.fn();
        const routeBack = vi.fn();
        const unregisterOverlay = registerBackHandler(overlayBack);
        const unregister = registerBackHandler(routeBack, 'route');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(overlayBack).toHaveBeenCalledTimes(1);
        expect(routeBack).not.toHaveBeenCalled();
        unregister();
        unregisterOverlay();
    });
});
