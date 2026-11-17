// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LIST_DETAIL_MIN_WIDTH } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { DISPLAY_PREFS_CACHE_KEY } from '../../../packages/core/src/shared/hooks/useSettingsRootAttributes.js';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qcontractownercontractownercontractxx';
let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return { width: layoutWidth, height: 800, top: 0, left: 0, right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {} };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
    try { globalThis.localStorage?.clear(); } catch { /* no storage */ }
});

function contracts(count) {
    return Array.from({ length: count }, (_, index) => ({
        action_index: String(index + 1),
        block_index: count - index,
        source: ADDRESS,
        status: 'valid',
        meta_name: index === 0 ? 'First Contract' : `Contract ${index + 1}`,
        meta_version: '1.0.0',
        meta_description: `Description ${index + 1}`,
    }));
}

function makeMessaging(count = 2) {
    const rows = contracts(count);
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: ADDRESS }] }),
        getContractsForSource: vi.fn().mockResolvedValue({ data: [] }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getContractsBrowseAll: vi.fn().mockResolvedValue({ data: rows }),
        getContractByActionIndex: vi.fn().mockImplementation(({ contractActionIndex }) => (
            Promise.resolve({ data: rows.find((row) => row.action_index === String(contractActionIndex)) || null })
        )),
        getActionByIndex: vi.fn().mockResolvedValue({ data: {} }),
        getContractState: vi.fn().mockResolvedValue({ data: [] }),
        getContractBalance: vi.fn().mockResolvedValue({ data: [] }),
        getExecutionsForContract: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    };
}

function Shell({ route = 'contracts-list', initialRef = null, initialView = 'all', onOpenContract = vi.fn(), onPick = vi.fn() }) {
    const [contractRef, setContractRef] = useState(initialRef);
    const detailFor = (ref, extra) => (
        <ContractDetail
            walletId="wallet-1"
            chainId={ref.chainId}
            contractActionIndex={ref.contractActionIndex}
            onBack={() => {}}
            {...extra}
        />
    );
    return (
        <ContractsList
            walletId="wallet-1"
            onBack={() => {}}
            onOpenContract={onOpenContract}
            initialView={initialView}
            selectedContract={contractRef}
            onSelectContract={(ref) => {
                onPick(ref);
                setContractRef(ref);
            }}
            renderContract={(ref, panel) => detailFor(ref, { embedded: true, headerSlot: panel.toolsSlot })}
            renderContractPage={route === 'contract-detail'
                ? (ref, page) => detailFor(ref, { measureRef: page.measureRef })
                : undefined}
        />
    );
}

function renderShell(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Shell {...props} />
        </MessagingProvider>,
    );
}

describe('ContractsList wide split', () => {
    it('docks the controls and selects the first contract beside the list', async () => {
        layoutWidth = 1046;
        const onPick = vi.fn();
        renderShell(makeMessaging(), { onPick });

        const detail = await screen.findByRole('region', { name: /First Contract/ });
        const listScroller = screen.getByRole('region', { name: 'Contracts list' });
        const first = screen.getByRole('button', { name: /Open First Contract/ });
        const tabs = screen.getByRole('tablist', { name: 'Contract views' });
        expect(first.closest('[data-list-detail]')).toHaveAttribute('data-list-detail', 'two-panel');
        expect(first).toHaveAttribute('aria-current', 'true');
        expect(await within(detail).findByRole('heading', { name: /First Contract/ })).toBeInTheDocument();
        expect(listScroller).not.toContainElement(tabs);
        expect(screen.getByRole('separator', { name: 'Resize the contracts list' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 }).map((node) => node.textContent)).toEqual(['Contracts']);
        expect(document.querySelectorAll('main')).toHaveLength(1);
        await waitFor(() => expect(onPick).toHaveBeenCalledWith({ chainId: CHAIN, contractActionIndex: '1' }));
    });

    it('swaps the detail without navigating and keeps the list mounted', async () => {
        layoutWidth = 1686;
        const onOpenContract = vi.fn();
        renderShell(makeMessaging(), { onOpenContract });

        await screen.findByRole('region', { name: /First Contract/ });
        const second = screen.getByRole('button', { name: /Open Contract 2/ });
        const list = second.closest('ul');
        fireEvent.click(second);

        const detail = await screen.findByRole('region', { name: /Contract 2/ });
        expect(await within(detail).findByRole('heading', { name: /Contract 2/ })).toBeInTheDocument();
        expect(onOpenContract).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Open Contract 2/ }).closest('ul')).toBe(list);
        expect(screen.getByRole('button', { name: /Open Contract 2/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: /Open First Contract/ })).not.toHaveAttribute('aria-current');
    });

    it('stores divider changes under the contracts key', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging());
        const separator = await screen.findByRole('separator', { name: 'Resize the contracts list' });
        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        await waitFor(() => expect(
            JSON.parse(globalThis.localStorage.getItem(DISPLAY_PREFS_CACHE_KEY)).panelSplits.contracts,
        ).toBeGreaterThan(0));
    });

    it('keeps the tabs docked when the initial view is empty', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(), { initialView: 'mine' });

        expect(await screen.findByText('No published contracts')).toBeInTheDocument();
        expect(screen.getByRole('tablist', { name: 'Contract views' })).toBeInTheDocument();
        expect(screen.getByRole('separator', { name: 'Resize the contracts list' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Contracts list' })).not.toContainElement(
            screen.getByRole('tablist', { name: 'Contract views' }),
        );
    });

    it('keeps the selected detail while switching to an empty tab', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging());
        const detail = await screen.findByRole('region', { name: /First Contract/ });
        expect(await within(detail).findByRole('heading', { name: /First Contract/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'My Contracts' }));

        expect(await screen.findByText('No published contracts')).toBeInTheDocument();
        const retainedDetail = screen.getByRole('region', { name: 'Contract detail' });
        expect(within(retainedDetail).getByRole('heading', { name: /First Contract/ })).toBeInTheDocument();
    });
});

describe('ContractsList narrow flow', () => {
    it.each([
        ['phone', 402],
        ['landscape phone', 640],
        ['under threshold', LIST_DETAIL_MIN_WIDTH - 1],
    ])('keeps the existing list route on a %s', async (_label, width) => {
        layoutWidth = width;
        const onOpenContract = vi.fn();
        renderShell(makeMessaging(), { onOpenContract });

        const second = await screen.findByRole('button', { name: /Open Contract 2/ });
        await waitFor(() => expect(second.closest('[data-list-detail]')).toHaveAttribute('data-list-detail', 'list'));
        expect(screen.queryByRole('separator')).toBeNull();
        expect(second).not.toHaveAttribute('aria-current');
        fireEvent.click(second);
        expect(onOpenContract).toHaveBeenCalledWith(CHAIN, '2');
    });
});

describe('Contract detail route', () => {
    it('opens as the same split with the deep-linked contract selected when wide', async () => {
        layoutWidth = 1046;
        renderShell(makeMessaging(), {
            route: 'contract-detail',
            initialRef: { chainId: CHAIN, contractActionIndex: '2' },
        });

        await screen.findByRole('region', { name: /Contract 2/ });
        expect(screen.getByRole('button', { name: /Open Contract 2/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('separator', { name: 'Resize the contracts list' })).toBeInTheDocument();
    });

    it('stays a standalone detail page when narrow and does not load the list', async () => {
        layoutWidth = 640;
        const messaging = makeMessaging();
        renderShell(messaging, {
            route: 'contract-detail',
            initialRef: { chainId: CHAIN, contractActionIndex: '2' },
        });

        expect(await screen.findByRole('heading', { level: 1, name: 'Contract Detail' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Open Contract/ })).toBeNull();
        expect(screen.queryByRole('separator')).toBeNull();
        expect(messaging.getContractsBrowseAll).not.toHaveBeenCalled();
        await waitFor(() => expect(messaging.getContractByActionIndex).toHaveBeenCalledTimes(1));
    });
});

describe('ContractsList wide read counts', () => {
    async function countsAt(rowCount) {
        layoutWidth = 1046;
        const messaging = makeMessaging(rowCount);
        const view = renderShell(messaging);
        const detail = await screen.findByRole('region', { name: /First Contract/ });
        await within(detail).findByRole('tablist', { name: 'Contract sections' });
        await waitFor(() => expect(messaging.getContractByActionIndex).toHaveBeenCalledTimes(1));
        const counts = Object.fromEntries(Object.entries(messaging).map(([name, fn]) => [name, fn.mock.calls.length]));
        view.unmount();
        return counts;
    }

    it('does not add detail reads when the list has more rows', async () => {
        expect(await countsAt(8)).toEqual(await countsAt(2));
    });
});
