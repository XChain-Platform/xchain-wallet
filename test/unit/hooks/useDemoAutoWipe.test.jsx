// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shells enforce demo expiry through this hook now that the page-top
// demo notice is gone, so the expiry cases the notice used to pin live here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { useDemoAutoWipe } from '../../../packages/core/src/shared/hooks/useDemoAutoWipe.js';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';

const exitDemoWallet = vi.hoisted(() => vi.fn(async () => ({ reloaded: false })));
vi.mock('../../../packages/core/src/shared/utils/demoGraduation.js', async (orig) => ({
    ...(await orig()),
    exitDemoWallet,
}));

const messaging = { listWallets: vi.fn(async () => ({ wallets: [] })) };

function Harness({ walletId, onExited }) {
    useDemoAutoWipe(walletId, onExited);
    return null;
}

function mount(walletId, onExited) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Harness walletId={walletId} onExited={onExited} />
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
    vi.useRealTimers();
});

describe('useDemoAutoWipe', () => {
    it('wipes an expired demo once, reports the exit, and draws nothing', async () => {
        markDemoWallet('demo-1', { ttlMs: 1, now: Date.now() - 1000 });
        const onExited = vi.fn();
        const view = mount('demo-1', onExited);

        await waitFor(() => expect(exitDemoWallet).toHaveBeenCalledTimes(1));
        expect(exitDemoWallet).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'demo-1' }));
        expect(onExited).toHaveBeenCalledTimes(1);
        expect(view.container).toBeEmptyDOMElement();
    });

    it('waits for the expiry before wiping the marked demo wallet', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
        markDemoWallet('demo-1', { ttlMs: 61_000, now: Date.now() });
        mount('demo-1');

        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(exitDemoWallet).not.toHaveBeenCalled();

        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(exitDemoWallet).toHaveBeenCalledTimes(1);
    });

    it('never wipes a wallet that is not the marked demo', async () => {
        markDemoWallet('demo-1', { ttlMs: 1, now: Date.now() - 1000 });
        await act(async () => { mount('real-wallet-1'); });
        expect(exitDemoWallet).not.toHaveBeenCalled();
    });

    it('does not apply an expired demo check to a replacement wallet', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
        markDemoWallet('demo-1', { ttlMs: 60_000, now: Date.now() });
        const view = mount('demo-1');
        expect(exitDemoWallet).not.toHaveBeenCalled();

        vi.setSystemTime(new Date('2026-10-13T12:02:00Z'));
        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <Harness walletId="real-wallet-1" />
            </MessagingProvider>,
        );
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(exitDemoWallet).not.toHaveBeenCalled();
    });
});
