// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PriceAlertForm } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';

afterEach(() => cleanup());

describe('PriceAlertForm', () => {
    it('explains why an empty target keeps the primary action disabled', () => {
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={vi.fn()} />);
        const action = screen.getByRole('button', { name: 'Add alert' });
        const target = screen.getByRole('textbox', { name: 'Target price' });

        expect(action).toBeDisabled();
        expect(action.getAttribute('aria-describedby')).toBe(target.getAttribute('aria-describedby'));
        const reason = document.getElementById(target.getAttribute('aria-describedby'));
        expect(reason).toBe(screen.getByRole('status'));
        expect(reason).toHaveTextContent('Enter a target price to continue.');
    });

    it('normalizes grouped decimal input and submits the numeric target', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={onCreate} />);

        const input = screen.getByRole('textbox', { name: 'Target price' });
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

    it('does not clear target input edited while a save is pending', async () => {
        let resolveSave;
        const onCreate = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={onCreate} />);
        const input = screen.getByRole('textbox', { name: 'Target price' });

        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));
        fireEvent.change(input, { target: { value: '20' } });
        await act(async () => resolveSave());

        expect(input.value).toBe('20');
        expect(screen.getByRole('button', { name: 'Add alert' })).toBeEnabled();
    });

    it('does not show a stale save failure after the input changes', async () => {
        let rejectSave;
        const onCreate = vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={onCreate} />);
        const input = screen.getByRole('textbox', { name: 'Target price' });

        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));
        fireEvent.change(input, { target: { value: '20' } });
        await act(async () => rejectSave(new Error('Save failed')));

        expect(input.value).toBe('20');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: 'Add alert' })).toBeEnabled();
    });

    it('uses style-guide controls and exposes save failures as an alert', async () => {
        render(<PriceAlertForm
            lockedChainId="bitcoin-mainnet"
            onCreate={vi.fn().mockRejectedValue(new Error('Save failed'))}
        />);
        const button = screen.getByRole('button', { name: 'Add alert' });
        expect(button.className).toMatch(/primary/);
        expect(screen.getByRole('textbox', { name: 'Target price' }).className).toMatch(/input/);

        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '10' } });
        fireEvent.click(button);
        expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    });

    it('replaces backend details with actionable save wording', async () => {
        render(<PriceAlertForm
            lockedChainId="bitcoin-mainnet"
            onCreate={vi.fn().mockRejectedValue(new Error('saveAlert: vault is required'))}
        />);

        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add alert' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the alert. Try again.');
        expect(screen.queryByText(/vault is required/)).toBeNull();
    });

    it('explains an invalid zero target and does not submit it', () => {
        const onCreate = vi.fn();
        render(<PriceAlertForm lockedChainId="bitcoin-mainnet" onCreate={onCreate} />);

        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '0' } });

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

        expect(screen.getByRole('combobox', { name: 'Coin' }).value).toBe('bitcoin-mainnet');
        expect(screen.getByRole('combobox', { name: 'Direction' }).value).toBe('below');
        expect(screen.getByRole('textbox', { name: 'Target price' }).value).toBe('65000');

        fireEvent.change(screen.getByRole('textbox', { name: 'Target price' }), { target: { value: '64000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            direction: 'below',
            targetFiat: 64000,
            fiatCurrency: 'eur',
        }));
    });
});
