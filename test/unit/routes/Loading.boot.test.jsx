// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Slow and failed boots on the web shell (the shell the phone builds run)
// and on the desktop renderer: each one gives way from the loading dots to a
// screen the user can act on, and a retry starts exactly one new boot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Loading } from '../../../packages/core/src/shared/routes/Loading.jsx';

const background = vi.hoisted(() => ({
    getSessionStatus: vi.fn(async () => ({ state: 'no-wallet' })),
    getSettings: vi.fn(async () => ({})),
    listWallets: vi.fn(async () => []),
    listAccounts: vi.fn(async () => []),
    getAddressesByChain: vi.fn(async () => ({})),
    getWalletBalances: vi.fn(async () => ({})),
}));

vi.mock('../../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: background.getSessionStatus,
    getSettings: background.getSettings,
    listWallets: background.listWallets,
    listAccounts: background.listAccounts,
    getAddressesByChain: background.getAddressesByChain,
    getWalletBalances: background.getWalletBalances,
    reportAutoLock: undefined,
}));

import {
    App as WebApp,
    SESSION_STATUS_TIMEOUT_MS as WEB_SESSION_STATUS_TIMEOUT_MS,
} from '../../../packages/web/src/App.jsx';
import {
    App as DesktopApp,
    SESSION_STATUS_TIMEOUT_MS,
} from '../../../packages/desktop/renderer/App.jsx';

const WELCOME = { name: 'XChain Wallet' };
const FAILED = { name: /wallet couldn't start/i };

function acceptLicense() {
    localStorage.setItem('xc:licenseAcceptedAt', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-01-01T00:00:00.000Z');
}

// The loading dots are a polite live region holding exactly three empty spans.
function loadingDots() {
    return [...document.querySelectorAll('div[aria-live="polite"]')].find((node) => (
        node.children.length === 3
        && [...node.children].every((child) => child.tagName === 'SPAN' && child.textContent === '')
    )) ?? null;
}

function installDesktopBridge(loadSession) {
    const sendMessage = vi.fn(({ type }) => (
        type === 'session.status' ? loadSession() : Promise.resolve({ ok: true, result: null })
    ));
    globalThis.xchainWalletBridge = { sendMessage };
    return () => sendMessage.mock.calls.filter(([message]) => message.type === 'session.status').length;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    acceptLicense();
    delete globalThis.xchainWalletBridge;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete globalThis.xchainWalletBridge;
});

describe('Loading screen on its own', () => {
    it('shows only the loading dots and no retry while a boot is pending', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <Loading />
            </MessagingProvider>,
        );
        expect(loadingDots()).not.toBeNull();
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    });

    it('reloads the page once when Try again is chosen without a retry action', () => {
        let reloads = 0;
        const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
        Object.defineProperty(globalThis, 'location', {
            configurable: true,
            value: { reload: () => { reloads += 1; } },
        });
        try {
            render(
                <MessagingProvider shell="web" messaging={{}}>
                    <Loading error="startup failure" />
                </MessagingProvider>,
            );
            fireEvent.click(screen.getByRole('button', { name: /try again/i }));
            expect(reloads).toBe(1);
        } finally {
            if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
            else delete globalThis.location;
        }
    });
});

describe('web shell boot', () => {
    it('replaces the dots with the failure screen when the vault read rejects', async () => {
        background.getSessionStatus.mockRejectedValueOnce(new Error('private storage detail'));
        render(<WebApp />);

        expect(await screen.findByRole('heading', FAILED)).toBeInTheDocument();
        expect(loadingDots()).toBeNull();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('private storage detail');
    });

    it('replaces the dots with the failure screen when the host chunk fails to import', async () => {
        background.getSessionStatus.mockRejectedValueOnce(
            new TypeError('Failed to fetch dynamically imported module: /assets/hostBridge.js'),
        );
        render(<WebApp />);

        expect(await screen.findByRole('heading', FAILED)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('hostBridge');
    });

    it('turns a reply with an unknown session state into the failure screen', async () => {
        background.getSessionStatus.mockResolvedValueOnce({ state: 'garbled' });
        render(<WebApp />);

        expect(await screen.findByRole('heading', FAILED)).toBeInTheDocument();
        expect(loadingDots()).toBeNull();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('turns a reply with no session state into the failure screen', async () => {
        background.getSessionStatus.mockResolvedValueOnce({});
        render(<WebApp />);

        expect(await screen.findByRole('heading', FAILED)).toBeInTheDocument();
        expect(loadingDots()).toBeNull();
    });

    it('waits out a 10 second storage adapter and then opens onboarding', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        background.getSessionStatus.mockImplementationOnce(() => new Promise((done) => {
            setTimeout(() => done({ state: 'no-wallet' }), 10_000);
        }));
        render(<WebApp />);
        expect(loadingDots()).not.toBeNull();

        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        vi.useRealTimers();

        expect(await screen.findByRole('heading', WELCOME)).toBeInTheDocument();
        expect(loadingDots()).toBeNull();
        expect(background.getSessionStatus).toHaveBeenCalledTimes(1);
    });

    it('gives way to the failure screen when the session read never settles', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        background.getSessionStatus.mockImplementationOnce(() => new Promise(() => {}));
        render(<WebApp />);
        expect(loadingDots()).not.toBeNull();

        await act(async () => { await vi.advanceTimersByTimeAsync(WEB_SESSION_STATUS_TIMEOUT_MS); });
        vi.useRealTimers();

        expect(await screen.findByRole('heading', FAILED)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(loadingDots()).toBeNull();
    });

    it('boots once more when Try again is pressed twice after a timeout', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        let settleRetry;
        background.getSessionStatus
            .mockImplementationOnce(() => new Promise(() => {}))
            .mockImplementationOnce(() => new Promise((done) => { settleRetry = done; }));
        render(<WebApp />);

        await act(async () => { await vi.advanceTimersByTimeAsync(WEB_SESSION_STATUS_TIMEOUT_MS); });
        vi.useRealTimers();

        const retry = await screen.findByRole('button', { name: /try again/i });
        fireEvent.click(retry);
        fireEvent.click(retry);
        await act(async () => { await Promise.resolve(); });
        expect(loadingDots()).not.toBeNull();
        expect(background.getSessionStatus).toHaveBeenCalledTimes(2);

        await act(async () => { settleRetry({ state: 'no-wallet' }); });
        expect(await screen.findByRole('heading', WELCOME)).toBeInTheDocument();
        expect(screen.queryByRole('heading', FAILED)).toBeNull();
        expect(background.getSessionStatus).toHaveBeenCalledTimes(2);
    });

    it('keeps a late first reply from replacing the failure screen or the retried boot', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        let settleFirst;
        let settleRetry;
        background.getSessionStatus
            .mockImplementationOnce(() => new Promise((done) => { settleFirst = done; }))
            .mockImplementationOnce(() => new Promise((done) => { settleRetry = done; }));
        render(<WebApp />);

        await act(async () => { await vi.advanceTimersByTimeAsync(WEB_SESSION_STATUS_TIMEOUT_MS); });
        vi.useRealTimers();
        expect(await screen.findByRole('heading', FAILED)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        await act(async () => { await Promise.resolve(); });
        expect(loadingDots()).not.toBeNull();

        await act(async () => { settleFirst({ state: 'no-wallet' }); await Promise.resolve(); });
        expect(loadingDots()).not.toBeNull();
        expect(screen.queryByRole('heading', WELCOME)).toBeNull();

        await act(async () => { settleRetry({ hasWallet: true, hasSession: false, state: 'locked' }); });
        await waitFor(() => expect(loadingDots()).toBeNull());
        expect(screen.queryByRole('heading', FAILED)).toBeNull();
        expect(screen.queryByRole('heading', WELCOME)).toBeNull();
        expect(document.querySelector('input[type="password"]')).not.toBeNull();
    });

    it('leaves the dots for the unlock screen when the vault holds 50 wallets', async () => {
        background.getSessionStatus.mockResolvedValueOnce({ hasWallet: true, hasSession: false, state: 'locked' });
        background.listWallets.mockResolvedValue(
            Array.from({ length: 50 }, (_, i) => ({ id: `wallet-${i + 1}`, name: `Wallet ${i + 1}` })),
        );
        render(<WebApp />);

        await waitFor(() => expect(loadingDots()).toBeNull());
        expect(screen.queryByRole('heading', FAILED)).toBeNull();
        expect(document.querySelector('input[type="password"]')).not.toBeNull();
    });

    it('ignores a boot that resolves after the app unmounts', async () => {
        let finish;
        background.getSessionStatus.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { unmount } = render(<WebApp />);
        await waitFor(() => expect(typeof finish).toBe('function'));
        unmount();

        await act(async () => { finish({ state: 'no-wallet' }); await Promise.resolve(); });

        expect(document.body.textContent).toBe('');
        expect(errors.mock.calls.flat().join(' ')).not.toMatch(/unmounted component|act\(/i);
        errors.mockRestore();
    });
});

describe('desktop renderer boot', () => {
    it('gives way to the failure screen at its timeout and a double press on Try again boots once', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        let attempts = 0;
        let settleRetry;
        const sessionReads = installDesktopBridge(() => {
            attempts += 1;
            if (attempts === 1) return new Promise(() => {});
            return new Promise((done) => { settleRetry = done; });
        });
        render(<DesktopApp />);
        expect(loadingDots()).not.toBeNull();

        await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_STATUS_TIMEOUT_MS); });
        vi.useRealTimers();

        const retry = await screen.findByRole('button', { name: /try again/i });
        fireEvent.click(retry);
        fireEvent.click(retry);
        await act(async () => { await Promise.resolve(); });
        expect(loadingDots()).not.toBeNull();
        expect(sessionReads()).toBe(2);

        await act(async () => { settleRetry({ ok: true, result: { state: 'no-wallet' } }); });
        await waitFor(() => expect(loadingDots()).toBeNull());
        expect(screen.queryByRole('heading', FAILED)).toBeNull();
        expect(sessionReads()).toBe(2);
    });

    it('ignores a boot that resolves after the renderer unmounts', async () => {
        let finish;
        installDesktopBridge(() => new Promise((done) => { finish = done; }));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { unmount } = render(<DesktopApp />);
        await waitFor(() => expect(typeof finish).toBe('function'));
        unmount();

        await act(async () => { finish({ ok: true, result: { state: 'no-wallet' } }); await Promise.resolve(); });

        expect(document.body.textContent).toBe('');
        expect(errors.mock.calls.flat().join(' ')).not.toMatch(/unmounted component/i);
        errors.mockRestore();
    });
});
