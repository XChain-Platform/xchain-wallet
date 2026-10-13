// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// the demo has to admit it is a demo, on Home, unprompted.
//
// THE DEFECT THIS PINS is an absence, not a rendering bug. DemoBanner
// ended in `return null` while still mounting for its 24h auto-expire
// effect, so the ONLY surface naming the demo was WalletDetails, a page
// a first-time visitor never opens. Home meanwhile showed a seven-figure
// fixture portfolio directly above action forms reading "0 BTC
// available" (read surfaces are fixture-fed, action forms are
// chain-fed), and nothing on screen reconciled the two. In a
// try-before-you-commit funnel that reads as a broken wallet.
//
// So two things are asserted about the copy, and both have to be true of
// the SAME visible element: it names the demo, and it says why the forms
// read zero. A banner that only says "Demo wallet" leaves the funnel
// exactly as broken as `return null` did.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

import { DemoBanner } from '../../../packages/core/src/shared/components/DemoBanner.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    markDemoWallet,
    clearDemoWalletId,
} from '../../../packages/core/src/flows/demoMode.js';

const exitDemoWallet = vi.hoisted(() => vi.fn(async () => ({ reloaded: false })));
vi.mock('../../../packages/core/src/shared/utils/demoGraduation.js', async (orig) => ({
    ...(await orig()),
    exitDemoWallet,
}));

const messaging = { listWallets: vi.fn(async () => ({ wallets: [] })) };
const popupAppSource = readFileSync(
    join(process.cwd(), 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);

function mount(props = {}) {
    return render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <DemoBanner {...props} />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    clearDemoWalletId();
    exitDemoWallet.mockClear();
    exitDemoWallet.mockResolvedValue({ reloaded: false });
});
afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.unstubAllGlobals();
});

function setNarrowViewport(narrow) {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: narrow,
        media: '(max-width: 599px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })));
}

describe('DemoBanner: the demo disclosure on Home', () => {
    it('renders nothing for a real wallet', () => {
        const { container } = mount({ activeWalletId: 'real-wallet-1' });
        expect(container.textContent).toBe('');
    });

    it('renders nothing when no wallet is active', () => {
        const { container } = mount({ activeWalletId: null });
        expect(container.textContent).toBe('');
    });

    it('tells a demo user, in one visible element, that it is a read-only demo AND why the action forms read 0', () => {
        markDemoWallet('demo-1');
        mount({ activeWalletId: 'demo-1' });

        // Visible, not merely mounted: the regression being pinned is a
        // component that mounted and drew nothing.
        const banner = screen.getByRole('status', { name: 'Demo wallet' });
        expect(banner).toBeTruthy();

        const text = banner.textContent.replace(/\s+/g, ' ');
        expect(text).toMatch(/demo/i);
        expect(text).toMatch(/read-only/i);
        // The half that WalletDetails never covered: the zero.
        expect(text).toMatch(/\b0 available\b/);
        expect(text).toMatch(/sample data/i);
        expect(text).toMatch(/not real coins/i);
    });

    it('carries the auto-wipe countdown so the disclosure includes the TTL', () => {
        markDemoWallet('demo-1', { now: Date.now() });
        mount({ activeWalletId: 'demo-1' });
        expect(screen.getByRole('status').textContent).toMatch(/Auto-wipes in/);
    });

    it('updates the visible countdown while the demo remains open', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
        try {
            markDemoWallet('demo-1', { ttlMs: 2 * 60 * 60 * 1000, now: Date.now() });
            mount({ activeWalletId: 'demo-1' });
            expect(screen.getByRole('status')).toHaveTextContent('Auto-wipes in 2h.');

            act(() => { vi.advanceTimersByTime(61 * 60_000); });

            expect(screen.getByRole('status')).toHaveTextContent('Auto-wipes in 59m.');
            expect(exitDemoWallet).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts collapsed on a narrow viewport and expands its details on request', async () => {
        setNarrowViewport(true);
        markDemoWallet('demo-1');
        mount({ activeWalletId: 'demo-1' });

        const toggle = screen.getByRole('button', { name: 'Details' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByText('Demo wallet: read-only; cannot move funds')).toBeVisible();
        expect(screen.queryByRole('button', { name: /exit demo/i })).toBeNull();

        await act(async () => { toggle.click(); });

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: /exit demo/i })).toBeVisible();
    });

    it('starts fully expanded on a wide viewport', () => {
        setNarrowViewport(false);
        markDemoWallet('demo-1');
        mount({ activeWalletId: 'demo-1' });

        expect(screen.getByRole('button', { name: 'Details' }))
            .toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('button', { name: /exit demo/i })).toBeVisible();
    });

    it('opens an explicit danger confirmation that names the demo data being destroyed', () => {
        setNarrowViewport(false);
        markDemoWallet('demo-1');
        mount({ activeWalletId: 'demo-1' });

        const trigger = screen.getByRole('button', { name: /exit demo/i });
        expect(trigger.className).toMatch(/danger/);
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog', { name: /exit demo and delete its data/i });
        expect(dialog).toHaveTextContent(/permanently deletes the demo wallet/i);
        expect(dialog).toHaveTextContent(/sample accounts, addresses, balances, and history/i);
        expect(dialog).toHaveTextContent(/real wallets and their data are not affected/i);
        expect(dialog).toHaveTextContent(/another wallet is available, the app opens it/i);
        expect(dialog).toHaveTextContent(/returns you to wallet setup/i);
        expect(exitDemoWallet).not.toHaveBeenCalled();
        expect(within(dialog).getByRole('button', { name: /exit demo/i }).className).toMatch(/danger/);
    });

    it('cancels the confirmation without running the teardown', () => {
        setNarrowViewport(false);
        markDemoWallet('demo-1');
        mount({ activeWalletId: 'demo-1' });
        fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(exitDemoWallet).not.toHaveBeenCalled();
    });

    it('shows a busy state, completes the confirmed teardown, and refreshes into onboarding', async () => {
        setNarrowViewport(false);
        markDemoWallet('demo-1');
        const onExited = vi.fn();
        let resolveExit;
        exitDemoWallet.mockReturnValueOnce(new Promise((resolve) => { resolveExit = resolve; }));
        mount({ activeWalletId: 'demo-1', onExited });

        fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));
        const dialog = screen.getByRole('dialog');
        const confirm = within(dialog).getByRole('button', { name: /exit demo/i });
        fireEvent.click(confirm);

        expect(dialog).toHaveAttribute('aria-busy', 'true');
        expect(confirm).toBeDisabled();
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
        resolveExit({ reloaded: false });
        await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));

        expect(exitDemoWallet).toHaveBeenCalledTimes(1);
        expect(exitDemoWallet.mock.calls[0][0]).toMatchObject({ walletId: 'demo-1' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('surfaces a failed exit in the dialog and re-enables retry and cancel', async () => {
        markDemoWallet('demo-1');
        exitDemoWallet.mockRejectedValueOnce(new Error('vault is busy'));
        mount({ activeWalletId: 'demo-1' });

        fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /exit demo/i }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent('vault is busy');
        expect(within(dialog).getByRole('button', { name: /exit demo/i })).toBeEnabled();
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });

    it('still auto-wipes an expired demo, which is what the null-rendering version was kept alive to do', async () => {
        markDemoWallet('demo-1', { ttlMs: 1, now: Date.now() - 1000 });
        await act(async () => { mount({ activeWalletId: 'demo-1' }); });
        expect(exitDemoWallet).toHaveBeenCalledTimes(1);
    });

    it('mounts the extension banner in the layout header so it cannot consume route height', () => {
        expect(popupAppSource).toMatch(
            /<FullLayoutWithNav[\s\S]*?header=\{\(\s*<>[\s\S]*?<AppHeader[\s\S]*?\{activeWalletId \? <DemoBanner activeWalletId=\{activeWalletId\} onExited=\{refresh\} \/> : null\}\s*<\/>\s*\)\}\s*bottomBar=/,
        );
        expect(popupAppSource).not.toMatch(
            /<FullLayoutWithNav[\s\S]*?>\s*\{activeWalletId \? \(\s*<DemoBanner/,
        );
    });
});
