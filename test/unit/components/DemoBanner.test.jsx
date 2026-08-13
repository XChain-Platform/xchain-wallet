// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the demo has to admit it is a demo, on Home, unprompted.
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
import { render, screen, act, cleanup } from '@testing-library/react';
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
afterEach(() => { cleanup(); clearDemoWalletId(); });

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

    it('offers the exit affordance, and pressing it runs the shared teardown', async () => {
        markDemoWallet('demo-1');
        const onExited = vi.fn();
        mount({ activeWalletId: 'demo-1', onExited });

        const button = screen.getByRole('button', { name: /exit demo/i });
        await act(async () => { button.click(); });

        expect(exitDemoWallet).toHaveBeenCalledTimes(1);
        expect(exitDemoWallet.mock.calls[0][0]).toMatchObject({ walletId: 'demo-1' });
        expect(onExited).toHaveBeenCalledTimes(1);
    });

    it('surfaces a failed exit instead of leaving the button silently dead', async () => {
        markDemoWallet('demo-1');
        exitDemoWallet.mockRejectedValueOnce(new Error('vault is busy'));
        mount({ activeWalletId: 'demo-1' });

        await act(async () => {
            screen.getByRole('button', { name: /exit demo/i }).click();
        });
        expect(screen.getByRole('alert').textContent).toContain('vault is busy');
    });

    it('still auto-wipes an expired demo, which is what the null-rendering version was kept alive to do', async () => {
        markDemoWallet('demo-1', { ttlMs: 1, now: Date.now() - 1000 });
        await act(async () => { mount({ activeWalletId: 'demo-1' }); });
        expect(exitDemoWallet).toHaveBeenCalledTimes(1);
    });
});
