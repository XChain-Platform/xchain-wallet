// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qcontractsfilter0000000000000000000000';
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
    localStorage.clear();
});

function messaging() {
    return new Proxy({
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getContractsForSource: vi.fn().mockResolvedValue({ data: [] }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getContractsBrowseAll: vi.fn().mockResolvedValue({
            data: [{ action_index: 12, source: ADDRESS, status: 'valid', meta_name: 'Escrow' }],
        }),
        getContractByActionIndex: vi.fn().mockResolvedValue({
            action_index: 12,
            source: ADDRESS,
            status: 'valid',
            meta_name: 'Escrow',
        }),
        getActionByIndex: vi.fn().mockResolvedValue({}),
        getContractState: vi.fn().mockResolvedValue({}),
        getContractBalance: vi.fn().mockResolvedValue({}),
        getExecutionsForContract: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    }, {
        get(target, property) {
            if (property in target) return target[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
}

function renderContracts() {
    return render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <ContractsList
                walletId="wallet-1"
                onBack={() => {}}
                onOpenContract={() => {}}
                renderContract={(ref, panel) => (
                    <ContractDetail
                        embedded
                        walletId="wallet-1"
                        chainId={ref.chainId}
                        contractActionIndex={ref.contractActionIndex}
                        headerSlot={panel.toolsSlot}
                        onBack={() => {}}
                    />
                )}
            />
        </MessagingProvider>,
    );
}

describe('ContractsList header filter', () => {
    it.each([
        ['phone width', 402],
        ['wide two-panel width', 1046],
    ])('keeps one filter at %s and opens search with Networks', async (_name, width) => {
        layoutWidth = width;
        renderContracts();

        await screen.findByRole('button', { name: 'Open Escrow (C:BTC:12)' });
        if (width >= 720) {
            await waitFor(() => expect(document.querySelector('[data-list-detail="two-panel"]')).not.toBeNull());
            await waitFor(() => expect(screen.queryByText('Loading contract…')).toBeNull());
        }

        const heading = screen.getByRole('heading', { level: 1, name: 'Contracts' });
        const header = heading.parentElement?.parentElement;
        const dialogTriggers = within(header).getAllByRole('button')
            .filter((button) => button.getAttribute('aria-haspopup') === 'dialog');
        expect(dialogTriggers).toHaveLength(1);
        expect(dialogTriggers[0]).toHaveAccessibleName('Filter contracts');
        expect(screen.queryByRole('button', { name: 'Search actions' })).toBeNull();

        fireEvent.click(dialogTriggers[0]);
        const search = await screen.findByRole('searchbox', { name: 'Search contracts' });
        expect(search).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Network: All networks' })).toBeInTheDocument();
        fireEvent.change(search, { target: { value: 'escrow' } });
        expect(dialogTriggers[0]).toHaveAttribute('data-active', 'true');
    });
});
