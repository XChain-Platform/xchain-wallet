// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function renderDetail({ onBuy = vi.fn() } = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qcreator' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        listGatedContent: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="wallet"
                chainId={CHAIN}
                tick="MARKETPROBE"
                kind="token"
                quantity="0"
                onBack={() => {}}
                onBuy={onBuy}
            />
        </MessagingProvider>,
    );
    return onBuy;
}

describe('TokenDetail Market view action', () => {
    it('opens the selected asset market even when the balance is zero', () => {
        const onBuy = renderDetail();
        const button = screen.getByText('Market view').closest('button');

        expect(button).toBeTruthy();
        fireEvent.click(button);
        expect(onBuy).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Sell on DEX')).toBeNull();
    });

    it('is absent when the shell has no market route', () => {
        renderDetail({ onBuy: null });

        expect(screen.queryByText('Market view')).toBeNull();
    });
});
