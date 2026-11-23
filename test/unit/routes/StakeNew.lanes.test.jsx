// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeNew } from '../../../packages/core/src/shared/routes/StakeNew.jsx';

afterEach(cleanup);

function renderChooser(byChain) {
    const onPickValidator = vi.fn();
    const onPickContract = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={{ getAddressesByChain: vi.fn().mockResolvedValue(byChain) }}>
            <StakeNew walletId="w" onPickValidator={onPickValidator} onPickContract={onPickContract} onBack={vi.fn()} />
        </MessagingProvider>,
    );
    return { onPickValidator, onPickContract };
}

describe('StakeNew gates each arm on its own lane', () => {
    it('opens contract staking for a wallet with only a Litecoin address and keeps validator staking closed', async () => {
        const { onPickContract, onPickValidator } = renderChooser({ 'litecoin-mainnet': [{ id: 'a1', address: 'ltc1qa' }] });

        const contract = await screen.findByRole('button', { name: /Contract staking/ });
        expect(contract).not.toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: /Validator staking/ })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText(/Validator staking is available on Bitcoin only/)).toBeInTheDocument();
        fireEvent.click(contract);
        expect(onPickContract).toHaveBeenCalledTimes(1);
        expect(onPickValidator).not.toHaveBeenCalled();
    });

    it('opens both arms for a wallet with a Bitcoin address', async () => {
        renderChooser({ 'bitcoin-mainnet': [{ id: 'a1', address: 'bc1qa' }] });

        expect(await screen.findByRole('button', { name: /Validator staking/ })).not.toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: /Contract staking/ })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('closes both arms for a wallet that holds no address', async () => {
        renderChooser({});

        expect(await screen.findByRole('button', { name: /Contract staking/ })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: /Validator staking/ })).toHaveAttribute('aria-disabled', 'true');
    });
});
