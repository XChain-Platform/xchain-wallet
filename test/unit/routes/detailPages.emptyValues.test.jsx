// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qsparsevaluesparsevaluesparsevaluesparse0';

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});

afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function messagingWith(overrides = {}) {
    const target = {
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(child, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>,
    );
}

function expectNoEmptyDetailCells(container) {
    expect(container.textContent).not.toMatch(/\b(?:undefined|null|NaN)\b/);
    for (const cell of container.querySelectorAll('dd, td')) {
        expect(cell.textContent.trim()).not.toBe('');
    }
}

function valueBeside(label) {
    const heading = screen.getByText(label, { exact: true });
    const row = heading.closest('tr');
    if (row) return row.querySelector('td');
    return heading.nextElementSibling;
}

describe('detail screens with sparse records', () => {
    it('uses placeholders for sparse token metadata', async () => {
        const messaging = messagingWith({
            getTokenInfo: vi.fn().mockResolvedValue({}),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        });
        const view = mount(
            <TokenDetail
                walletId="wallet"
                chainId={CHAIN}
                tick="SPARSE"
                kind="token"
                quantity="0"
                onBack={() => {}}
            />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        await waitFor(() => expect(valueBeside('Total supply')).toHaveTextContent('-'));
        expect(valueBeside('Estimated value')).toHaveTextContent('-');
        expect(valueBeside('Status')).toHaveTextContent('-');
        expectNoEmptyDetailCells(view.container);
    });

    it('uses placeholders for a sparse dispenser record', async () => {
        const messaging = messagingWith({
            getDispenserByActionIndex: vi.fn().mockResolvedValue({ action_index: '7' }),
        });
        const view = mount(
            <DispenserDetail
                walletId="wallet"
                chainId={CHAIN}
                actionIndex="7"
                onBack={() => {}}
            />,
            messaging,
        );

        await screen.findByRole('heading', { name: 'Dispenser details' });
        expect(valueBeside('Dispensing')).toHaveTextContent('-');
        expect(valueBeside('Payment')).toHaveTextContent('-');
        expect(valueBeside('Status')).toHaveTextContent('-');
        expectNoEmptyDetailCells(view.container);
    });

    it('uses placeholders for sparse stake, delegation, and reward records', async () => {
        const messaging = messagingWith({
            getStakesForAddress: vi.fn().mockResolvedValue({ data: [{}] }),
            getDelegationsForAddress: vi.fn().mockResolvedValue({ data: [{}] }),
            getRewardsForAddress: vi.fn().mockResolvedValue({ data: [{}] }),
            getRewardClaimsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 10 }),
        });
        const view = mount(
            <StakeDetail
                walletId="wallet"
                kind="validator"
                chainId={CHAIN}
                address={ADDRESS}
                onBack={() => {}}
            />,
            messaging,
        );

        await screen.findByRole('heading', { name: 'Position details' });
        expect(valueBeside('Staked')).toHaveTextContent('- XCHAIN');
        expect(valueBeside('Delegated key')).toHaveTextContent('None');
        const rewards = screen.getByRole('list');
        for (const value of within(rewards).getAllByText('-', { exact: true })) {
            expect(value.textContent).toBe('-');
        }
        expectNoEmptyDetailCells(view.container);
    });

    it('uses placeholders for empty and non-finite action fields', async () => {
        const messaging = messagingWith({
            listContacts: vi.fn().mockResolvedValue([]),
            verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
        });
        const view = mount(
            <ActionDetail
                walletId="wallet"
                entry={{
                    key: 'sparse-action',
                    chainId: CHAIN,
                    action: 'ORDER',
                    actionIndex: '7',
                    blockIndex: 10,
                    address: ADDRESS,
                    raw: { destination: '', memo: null, quantity: Number.NaN },
                }}
                onBack={() => {}}
            />,
            messaging,
        );

        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        for (const label of ['To', 'Memo', 'Quantity']) {
            expect(valueBeside(label)).toHaveTextContent('-');
        }
        expectNoEmptyDetailCells(view.container);
    });

    it('uses placeholders in sparse order summaries and detail fields', async () => {
        const owner = { id: 'address-1', address: ADDRESS, source: 'hd' };
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [owner] }),
            getOrdersForAddress: vi.fn().mockResolvedValue({ data: [{ source: ADDRESS, status: 'valid' }] }),
            getOrderCancelsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            getOrderDetail: vi.fn().mockResolvedValue(null),
            listAutopayOrders: vi.fn().mockResolvedValue([]),
        });
        const view = mount(
            <MyOrdersView walletId="wallet" onBack={() => {}} />,
            messaging,
        );

        const list = await screen.findByRole('list', { name: 'Open orders' });
        expect(within(list).getByText('Give - → get -')).toBeTruthy();
        expect(list.textContent).toContain('#-');
        fireEvent.click(within(list).getByRole('button', { name: 'Edit' }));
        await screen.findByRole('heading', { name: 'Edit order' });
        expect(valueBeside('Order')).toHaveTextContent('#-');
        expectNoEmptyDetailCells(view.container);
    });
});
