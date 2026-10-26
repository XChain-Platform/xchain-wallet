// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One message per state. A failed contracts read repeated the same sentence and
// the same retry under every chain of every section, up to nine times.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';

const ADDRESSES = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet']
    .reduce((acc, cid) => ({ ...acc, [cid]: [{ address: `addr-${cid}-aaaaaaaaaaaaaaaaaaaaaaaaaaaa` }] }), {});

function mount(overrides = {}) {
    const fail = () => Promise.reject(new Error('Explorer returned HTTP 502'));
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getContractsForSource: vi.fn(fail),
        getDepositsForAddress: vi.fn(fail),
        getWithdrawalsForAddress: vi.fn(fail),
        getContractsBrowseAll: vi.fn(fail),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ContractsList walletId="wallet-1" onBack={() => {}} onOpenContract={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(cleanup);

describe('ContractsList failure notice', () => {
    it('says a failed read once, with one retry, and does not call the sections empty', async () => {
        mount();
        await screen.findByRole('alert');
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
        expect(screen.queryByText('No published contracts')).toBeNull();
        expect(screen.queryByText('No indexed contracts')).toBeNull();
    });

    it('retries every read from the one notice', async () => {
        const messaging = mount();
        await screen.findByRole('alert');
        const before = messaging.getContractsBrowseAll.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await screen.findByRole('alert');
        expect(messaging.getContractsBrowseAll.mock.calls.length).toBeGreaterThan(before);
    });
});
