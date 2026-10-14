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
// the More sheet) before it navigates or leaves the app. With only screens
// registered, Back on Home with the header settings popover open closed the
// whole app on an LG K51.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, cleanup, fireEvent, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { ConfirmModal } from '../../../packages/core/src/shared/components/ConfirmModal.jsx';
import { NoticeModal } from '../../../packages/core/src/shared/components/NoticeModal.jsx';
import { BottomTabBar } from '../../../packages/core/src/shared/components/BottomTabBar.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { HeaderSettingsButton } from '../../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { useFormLeaveGuard } from '../../../packages/core/src/shared/hooks/useFormLeaveGuard.js';

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

    it('closes a dropdown on native Back before reaching the route', () => {
        const onBack = vi.fn();
        render(
            <>
                <AppHeader onScan={() => {}} />
                <PageHeader title="Receive" onBack={onBack} />
            </>,
        );
        const trigger = screen.getByRole('button', { name: 'Scan and addresses' });
        fireEvent.click(trigger);
        expect(screen.getByRole('menu', { name: 'Scan and addresses' })).toBeInTheDocument();

        act(() => nativeBack({ canGoBack: true }));

        expect(screen.queryByRole('menu', { name: 'Scan and addresses' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
    });

    it('closes the header settings menu on native Back before reaching the route', () => {
        const onBack = vi.fn();
        render(
            <>
                <HeaderSettingsButton
                    activeWallet={{ id: 'wallet-a', name: 'Main Wallet' }}
                    onOpenWalletPicker={() => {}}
                />
                <PageHeader title="Receive" onBack={onBack} />
            </>,
        );
        const trigger = screen.getByRole('button', { name: 'Settings' });
        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Wallet settings' })).toBeInTheDocument();

        act(() => nativeBack({ canGoBack: true }));

        expect(screen.queryByRole('dialog', { name: 'Wallet settings' })).toBeNull();
        expect(onBack).not.toHaveBeenCalled();
    });

    it('closes the More sheet on native Back, then lets the next press reach the screen', async () => {
        const onBack = vi.fn();
        render(
            <>
                <PageHeader title="Receive" onBack={onBack} />
                <BottomTabBar currentView="receive" onSelect={() => {}} onLock={() => {}} />
            </>,
        );
        await settle();
        const more = screen.getByRole('button', { name: /More/ });
        fireEvent.click(more);
        await settle();
        expect(more.getAttribute('aria-expanded')).toBe('true');
        act(() => nativeBack({ canGoBack: true }));
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(more).toHaveFocus();
        expect(onBack).not.toHaveBeenCalled();
        act(() => nativeBack({ canGoBack: true }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('closes the More sheet completely on an iOS edge swipe before navigating', () => {
        const onBack = vi.fn();
        render(
            <>
                <PageHeader title="Receive" onBack={onBack} />
                <BottomTabBar currentView="receive" onSelect={() => {}} />
            </>,
        );
        const more = screen.getByRole('button', { name: /More/ });
        fireEvent.click(more);

        swipeBackFromIOS();

        expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
        expect(more).toHaveAttribute('aria-expanded', 'false');
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
