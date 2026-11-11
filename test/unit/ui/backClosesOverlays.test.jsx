// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The system Back gesture closes the topmost overlay (a dialog, a popover,
// the wallet menu) before it navigates or leaves the app. With only screens
// registered, Back on Home with the header settings popover open closed the
// whole app on an LG K51.

import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, cleanup, fireEvent, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { useFormLeaveGuard } from '../../../packages/core/src/shared/hooks/useFormLeaveGuard.js';
import { preloadOnDemandOverlays } from '../../../packages/core/src/shared/components/onDemandOverlays.js';

// The app loads these on idle after first paint; load them up front here.
beforeAll(() => preloadOnDemandOverlays());

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });
const armed = () => Boolean(window.history.state && window.history.state.xcBack);
let nativeBack;
let capacitorApp;
async function pressBack() {
    window.history.back();
    await settle();
}

function swipeBackFromIOS() {
    act(() => window.dispatchEvent(new Event('xchain:native-edge-back')));
}

function MenuHarness() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open menu</button>
            <CommandPalette
                open={open}
                onClose={() => setOpen(false)}
                commands={[]}
                menu={{
                    gates: {},
                    currentView: 'receive',
                    onSelect: () => {},
                    onOpenSettings: () => {},
                }}
            />
        </>
    );
}

function DirtyForm({ onLeave }) {
    const leaveGuard = useFormLeaveGuard({ dirty: true, onLeave });
    return (
        <>
            <PageHeader title="Edit payment" onBack={leaveGuard.guardedOnBack} />
            <input aria-label="Amount" defaultValue="12.50" />
            {leaveGuard.confirmation}
        </>
    );
}

beforeEach(() => {
    resetBackStackForTests();
    window.history.replaceState(null, '');
    capacitorApp = {
        addListener: vi.fn((_event, listener) => {
            nativeBack = listener;
            return { remove: vi.fn() };
        }),
        minimizeApp: vi.fn(),
    };
    globalThis.Capacitor = { Plugins: { App: capacitorApp } };
});

afterEach(async () => {
    cleanup();
    await settle();
    resetBackStackForTests();
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
});

describe('Back closes overlays first', () => {
    it('cancels an open confirm dialog instead of leaving the screen', async () => {
        const onBack = vi.fn();
        const onCancel = vi.fn();
        render(
            <>
                <PageHeader title="Send" onBack={onBack} />
                <ConfirmModal title="Discard?" message="Leave this form?" onConfirm={() => {}} onCancel={onCancel} />
            </>,
        );
        await settle();
        expect(armed()).toBe(true);
        await pressBack();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('closes a notice on a screen with no back action, so Back does not leave the app', async () => {
        const onClose = vi.fn();
        render(<NoticeModal title="Heads up" message="Something happened." onClose={onClose} />);
        await settle();
        expect(armed()).toBe(true);
        await pressBack();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps a busy dialog open without navigating on native Back', () => {
        const onBack = vi.fn();
        const onCancel = vi.fn();
        render(
            <>
                <PageHeader title="Send" onBack={onBack} />
                <ConfirmModal
                    title="Sending"
                    message="Wait for the request to finish."
                    busy
                    onConfirm={() => {}}
                    onCancel={onCancel}
                />
            </>,
        );

        act(() => nativeBack({ canGoBack: true }));

        expect(screen.getByRole('dialog', { name: 'Sending' })).toBeInTheDocument();
        expect(onCancel).not.toHaveBeenCalled();
        expect(onBack).not.toHaveBeenCalled();
        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });

    it('closes the wallet menu on native Back, then lets the next press reach the screen', async () => {
        const onBack = vi.fn();
        render(
            <>
                <PageHeader title="Receive" onBack={onBack} />
                <MenuHarness />
            </>,
        );
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
        await settle();
        expect(screen.getByRole('dialog', { name: 'Wallet menu' })).toBeInTheDocument();
        act(() => nativeBack({ canGoBack: true }));
        expect(screen.queryByRole('dialog', { name: 'Wallet menu' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
        act(() => nativeBack({ canGoBack: true }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('closes the wallet menu completely on an iOS edge swipe before navigating', async () => {
        const onBack = vi.fn();
        render(
            <>
                <PageHeader title="Receive" onBack={onBack} />
                <MenuHarness />
            </>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
        await settle();
        expect(screen.getByRole('dialog', { name: 'Wallet menu' })).toBeInTheDocument();

        swipeBackFromIOS();

        expect(screen.queryByRole('dialog', { name: 'Wallet menu' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
    });

    it('opens the dirty-form prompt on an iOS edge swipe instead of leaving', () => {
        const onLeave = vi.fn();
        render(<DirtyForm onLeave={onLeave} />);

        swipeBackFromIOS();

        expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
        expect(onLeave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onLeave).not.toHaveBeenCalled();
    });
});
