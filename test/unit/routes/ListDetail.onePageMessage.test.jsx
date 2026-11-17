// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A list owned by another address still opens owner-action forms. Those forms
// perform the ownership refusal only after the user chooses an action.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

afterEach(cleanup);

describe('ListDetail page messages', () => {
    it('keeps owner rows enabled and shows an empty member list as a plain line', async () => {
        const onFork = vi.fn();
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({ type: '0', status: 'valid', source: 'owner-address', list: [] }),
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'my-address' }] }),
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ListDetail walletId="wallet-1" chainId="bitcoin-mainnet" actionIndex="77" onBack={() => {}} onFork={onFork} />
            </MessagingProvider>,
        );
        const edit = await screen.findByRole('button', { name: /^Edit(?! look)\b/ });
        expect(edit).not.toHaveAttribute('aria-disabled');
        expect(edit).toHaveTextContent('Change the members, name or description');
        fireEvent.click(edit);
        expect(onFork).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-variant="warning"]')).toBeNull();
        expect(screen.queryByText(/read-only/i)).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'List' }));
        await screen.findByText(/No list members/);
        // No notice and no empty-state block: the empty members show as a plain line.
        expect(container.querySelectorAll('[data-variant], [data-empty-state]')).toHaveLength(0);
    });
});
