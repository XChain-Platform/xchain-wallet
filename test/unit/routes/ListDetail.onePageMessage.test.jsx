// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A list owned by another address shows the read-only warning as its one page
// message, first in the content; an empty member list is a plain line.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

afterEach(cleanup);

describe('ListDetail page messages', () => {
    it('keeps the read-only warning first and shows an empty member list as a plain line', async () => {
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({ type: '0', status: 'valid', source: 'owner-address', list: [] }),
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'my-address' }] }),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListDetail walletId="wallet-1" chainId="bitcoin-mainnet" actionIndex="77" onBack={() => {}} onFork={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText(/No list members/);
        await screen.findByText(/owned by another address/);
        expect(container.querySelectorAll('[data-variant], [data-empty-state]')).toHaveLength(1);
        const warning = container.querySelector('[data-variant="warning"]');
        expect(warning).toHaveTextContent('This list is owned by another address, so it is read-only in this wallet.');
        expect(container.querySelector('dl').compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });
});
