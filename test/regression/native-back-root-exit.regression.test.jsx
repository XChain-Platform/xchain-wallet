// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Android Back leaves the app from Welcome and unlock.
//
//   [P1] 2026-10-23: only Home was a native Back root, so hardware Back did
//        nothing on Welcome and on the unlock screen. Every root takes two
//        presses within two seconds, and the first press says so.

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { Locked } from '../../packages/core/src/shared/routes/Locked.jsx';
import { Onboarding } from '../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../packages/core/src/buildInfo.js';
import { resetBackStackForTests, useNativeBackRoot } from '../../packages/core/src/ui/backStack.js';

const EXIT_HINT = 'Press Back again to exit.';
let nativeBack;
let capacitorApp;

function mount(node) {
    return render(
        <MessagingProvider shell="web" messaging={{ unlockWallet: vi.fn() }}>
            <ToastHost>{node}</ToastHost>
        </MessagingProvider>,
    );
}

function pressBack() {
    act(() => nativeBack({ canGoBack: false }));
}

beforeEach(() => {
    resetBackStackForTests();
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
    capacitorApp = {
        addListener: vi.fn((event, listener) => {
            if (event === 'backButton') nativeBack = listener;
            return { remove: vi.fn() };
        }),
        minimizeApp: vi.fn(),
    };
    globalThis.Capacitor = { Plugins: { App: capacitorApp } };
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    localStorage.clear();
    delete globalThis.Capacitor;
    delete globalThis.matchMedia;
    nativeBack = undefined;
});

const welcome = () => (
    <Onboarding
        onCreate={vi.fn()}
        onImport={vi.fn()}
        onImportFromFreeWallet={vi.fn()}
        onPairPartner={vi.fn()}
    />
);

describe('regression/native-back-root-exit', () => {
    it.each([
        ['Welcome', welcome],
        ['the unlock screen', () => <Locked onUnlocked={vi.fn()} />],
    ])('[REGRESSION P1] leaves the app from %s on a second Back press', (_name, screenFor) => {
        mount(screenFor());
        expect(nativeBack).toBeTypeOf('function');

        pressBack();
        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
        expect(screen.getByText(EXIT_HINT)).toBeInTheDocument();

        pressBack();
        expect(capacitorApp.minimizeApp).toHaveBeenCalledOnce();
    });

    it.each([
        ['Welcome', welcome],
        ['the unlock screen', () => <Locked onUnlocked={vi.fn()} />],
    ])('[REGRESSION P1] ignores history left by an ended session on %s', (_name, screenFor) => {
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
        mount(screenFor());

        act(() => nativeBack({ canGoBack: true }));
        act(() => nativeBack({ canGoBack: true }));

        expect(historyBack).not.toHaveBeenCalled();
        expect(capacitorApp.minimizeApp).toHaveBeenCalledOnce();
        historyBack.mockRestore();
    });

    it('[REGRESSION P1] keeps the unlock screen as the root when Home unmounts after it', () => {
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
        const HomeRoot = () => { useNativeBackRoot(true, undefined); return null; };
        const view = mount(<HomeRoot key="home" />);
        // The unlock screen mounts while Home is still there, then Home goes.
        view.rerender(
            <MessagingProvider shell="web" messaging={{ unlockWallet: vi.fn() }}>
                <ToastHost><HomeRoot key="home" /><Locked key="locked" onUnlocked={vi.fn()} /></ToastHost>
            </MessagingProvider>,
        );
        view.rerender(
            <MessagingProvider shell="web" messaging={{ unlockWallet: vi.fn() }}>
                <ToastHost><Locked key="locked" onUnlocked={vi.fn()} /></ToastHost>
            </MessagingProvider>,
        );

        act(() => nativeBack({ canGoBack: true }));

        expect(historyBack).not.toHaveBeenCalled();
        expect(screen.getByText(EXIT_HINT)).toBeInTheDocument();
        historyBack.mockRestore();
    });

    it('[REGRESSION P1] keeps the add-wallet lane off the exit path', () => {
        const onBack = vi.fn();
        mount(
            <Onboarding
                onCreate={vi.fn()}
                onImport={vi.fn()}
                onImportFromFreeWallet={vi.fn()}
                onPairPartner={vi.fn()}
                onBack={onBack}
                mode="add"
            />,
        );

        pressBack();
        pressBack();

        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
        expect(screen.queryByText(EXIT_HINT)).toBeNull();
    });
});
