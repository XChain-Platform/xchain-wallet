// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PriceAlertForm } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';

afterEach(() => cleanup());

describe('PriceAlertForm', () => {
    it('normalizes grouped decimal input and submits the numeric target', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={onCreate} />);

        const input = screen.getByLabelText('Target price');
        fireEvent.change(input, { target: { value: '12,345.67' } });
        expect(input.value).toBe('12345.67');

        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));
        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            direction: 'above',
            targetFiat: 12345.67,
            fiatCurrency: 'usd',
        }));
    });

    it('uses theme tokens and exposes save failures as an alert', async () => {
        render(<PriceAlertForm
            lockedChainId="bitcoin-mainnet"
            onCreate={vi.fn().mockRejectedValue(new Error('Save failed'))}
        />);
        const button = screen.getByRole('button', { name: 'Add alert' });
        expect(button.style.background).toBe('var(--xc-accent-primary)');
        expect(button.style.color).toBe('var(--xc-on-accent)');

        fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '10' } });
        fireEvent.click(button);
        expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    });

    it('replaces backend details with actionable save wording', async () => {
        render(<PriceAlertForm
            lockedChainId="bitcoin-mainnet"
            onCreate={vi.fn().mockRejectedValue(new Error('saveAlert: vault is required'))}
        />);

        fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the alert. Try again.');
        expect(screen.queryByText(/vault is required/)).toBeNull();
    });

    it('explains an invalid zero target and does not submit it', () => {
        const onCreate = vi.fn();
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={onCreate} />);

        fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '0' } });

        expect(screen.getByRole('alert')).toHaveTextContent('Enter a price greater than zero.');
        expect(screen.getByRole('button', { name: 'Add alert' })).toBeDisabled();
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('prefills an existing alert and submits edited values', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<PriceAlertForm
            initialAlert={{ chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 65000 }}
            fiatCurrency="eur"
            onCreate={onCreate}
            onCancel={vi.fn()}
        />);

        expect(screen.getByLabelText('Coin').value).toBe('bitcoin-mainnet');
        expect(screen.getByLabelText('Direction').value).toBe('below');
        expect(screen.getByLabelText('Target price').value).toBe('65000');

        fireEvent.change(screen.getByLabelText('Target price'), { target: { value: '64000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            direction: 'below',
            targetFiat: 64000,
            fiatCurrency: 'eur',
        }));
    });
});
