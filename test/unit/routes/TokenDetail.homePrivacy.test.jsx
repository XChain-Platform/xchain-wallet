// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HomeWideLayout } from '../../../packages/core/src/shared/components/HomeWideLayout.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
let savedResizeObserver;

function messagingFor() {
    return {
        getSettings: vi.fn().mockResolvedValue({}),
        getNativePricesRequest: vi.fn().mockResolvedValue({ prices: {} }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qcreator', divisibility: 8 }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
    };
}

function tokenDetail(embedded) {
    return (
        <TokenDetail
            walletId="wallet-wide"
            chainId={CHAIN}
            tick="XCP"
            kind="token"
            displayName="Counterparty"
            divisibility={8}
            quantity="31000000000"
            embedded={embedded}
            onBack={() => {}}
        />
    );
}

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
beforeEach(() => window.localStorage.clear());
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    window.localStorage.clear();
});

describe('Home wide balance privacy control', () => {
    it('renders exactly one privacy toggle across the wallet hero and detail panel', async () => {
        const messaging = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <HomeWideLayout
                    hero={(
                        <TotalBalanceHero
                            rows={[{
                                kind: 'token',
                                chainId: CHAIN,
                                tick: 'XCP',
                                quantity: '31000000000',
                                divisibility: 8,
                                fiatRate: 1,
                            }]}
                            walletId="wallet-wide"
                            networkFilter="all"
                        />
                    )}
                    allocation={<div>Allocation</div>}
                    listHeader={<div>Balances</div>}
                    list={<div>Assets</div>}
                    detail={tokenDetail(true)}
                    detailLabel="Counterparty"
                />
            </MessagingProvider>,
        );

        await screen.findByRole('heading', { name: 'Counterparty' });
        const privacyToggle = screen.getAllByRole('button', { name: /^(Hide|Show) balance$/ });
        expect(privacyToggle).toHaveLength(1);

        fireEvent.click(privacyToggle[0]);
        const detailPanel = document.querySelector('[data-home-detail]');
        await waitFor(() => {
            expect(within(detailPanel).getAllByLabelText('Balance hidden').length).toBeGreaterThan(0);
        });
    });

    it('keeps the privacy toggle on standalone Token Detail', async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                {tokenDetail(false)}
            </MessagingProvider>,
        );

        expect(await screen.findByRole('button', { name: 'Hide balance' })).toBeInTheDocument();
    });
});
