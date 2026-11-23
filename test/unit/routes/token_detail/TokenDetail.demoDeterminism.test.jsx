// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => String(id).startsWith('demo-session-') };
});

import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
let savedResizeObserver;

beforeAll(() => {
    class StubObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});

afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

beforeEach(() => {
    globalThis.localStorage.clear();
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.restoreAllMocks();
});

function messagingStub() {
    return {
        getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
        getTokenInfo: vi.fn(async () => ({ creator: 'bc1qdemo', totalSupply: '1250000' })),
        getAddressesByChain: vi.fn(async () => ({ [CHAIN]: [{ address: 'bc1qdemo' }] })),
        getAddressHistory: vi.fn(async () => ({ data: [] })),
        getHoldersForToken: vi.fn(async () => ({ data: [] })),
        listGatedContent: vi.fn(async () => []),
        getSupplyHistory: vi.fn(async () => []),
    };
}

async function generatedBeanSeries(walletId) {
    const view = render(
        <MessagingProvider shell="web" messaging={messagingStub()}>
            <TokenDetail
                walletId={walletId}
                chainId={CHAIN}
                tick="BEANCOIN"
                kind="token"
                quantity="2500000000000"
                divisibility={8}
                fiatRate={0.08}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    const chart = await screen.findByRole('img', { name: /^Value over 1W\./ });
    const series = chart.querySelector('polyline[data-chart-tone]')?.getAttribute('points');
    const label = chart.getAttribute('aria-label');
    view.unmount();
    return { series, label };
}

describe('TokenDetail demo value history', () => {
    it('generates the same Bean Coin series for two demo sessions', async () => {
        const first = await generatedBeanSeries('demo-session-one');
        const second = await generatedBeanSeries('demo-session-two');

        expect(first.series?.length).toBeGreaterThan(10);
        expect(first.label).toContain('End $2K.');
        expect(second).toEqual(first);
    });
});
