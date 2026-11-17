// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Add Price Alert and Edit Price Alert form (Form Standard, 2026-11-14):
// the Asset field, the "Rises above / Falls below" themed dropdown, the Target
// price with the live price under it, the fires-once line and the green button.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PriceAlertForm, formatCurrentPrice } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';
import { selectOption, selectOptionLabels } from '../../helpers/selectOption.js';

afterEach(() => cleanup());

const target = () => screen.getByRole('textbox', { name: 'Target price' });
const direction = () => screen.getByRole('button', { name: /^When the price/ });
const save = (name = 'Add Alert') => screen.getByRole('button', { name });

describe('PriceAlertForm', () => {
    it('puts the fires-once notice first, then fields and the green full-width button', () => {
        render(<PriceAlertForm walletId="wallet-1" onCreate={vi.fn()} />);

        const notice = screen.getByText('Fires once when the price gets there. Re-arm it to watch again.');
        const asset = screen.getByRole('button', { name: 'Asset: Select an asset' });
        expect(asset).toBeEnabled();
        expect(direction()).toBeTruthy();
        expect(target()).toBeTruthy();
        const button = save();
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(notice, asset)).toBe(true);
        expect(document.querySelector('[data-form-section-title]')).toBeNull();
        expect(button.className).toMatch(/success/);
        expect(button.className).toMatch(/block/);
        expect(button.querySelector('svg')).toBeTruthy();
        expect(button).toBeEnabled();
    });

    it('offers Rises above and Falls below as a themed dropdown with an icon on each', () => {
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" onCreate={vi.fn()} />);
        expect(selectOptionLabels(direction())).toEqual(['Rises above', 'Falls below']);
        selectOption(direction(), 'below');
        expect(direction()).toHaveAccessibleName('When the price: Falls below');
    });

    it('puts the Asset field, the direction, the price and the button in that order', () => {
        render(<PriceAlertForm walletId="wallet-1" initialChainId="bitcoin-mainnet" onCreate={vi.fn()} />);
        const asset = screen.getByRole('button', { name: /^Asset:/ });
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(asset, direction())).toBe(true);
        expect(follows(direction(), target())).toBe(true);
        expect(follows(target(), save())).toBe(true);
    });

    it('shows the current price under the target with how far it has to go', () => {
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" currentPrice={68000} onCreate={vi.fn()} />);
        expect(screen.getByText('Now $68,000')).toBeTruthy();

        fireEvent.change(target(), { target: { value: '70000' } });
        expect(screen.getByText('Now $68,000, so 2.9% to go')).toBeTruthy();
        expect(target().getAttribute('aria-describedby')).toBe(
            document.querySelector('[data-price-now]').id,
        );
    });

    it('groups prices without rounding away their stored precision', () => {
        expect(formatCurrentPrice(123456.12345678, 'usd')).toBe('$123,456.12345678');
        expect(formatCurrentPrice(0.00000001, 'eur')).toBe('0.00000001 EUR');
    });

    it('asks for an asset on submit and creates nothing', () => {
        const onCreate = vi.fn();
        render(<PriceAlertForm onCreate={onCreate} />);
        expect(screen.getByText('Pick an asset to see its price now')).toBeTruthy();
        expect(save()).toBeEnabled();
        fireEvent.click(save());
        expect(screen.getByLabelText('Form errors')).toHaveTextContent('Select an asset');
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('notes a target the price has already met', () => {
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" currentPrice={68000} onCreate={vi.fn()} />);
        fireEvent.change(target(), { target: { value: '65000' } });
        expect(screen.getByText('BTC is already above $65,000. This alert will fire on the next check.')).toBeTruthy();
        expect(save()).toBeEnabled();
    });

    it('normalizes grouped decimal input and submits the numeric target', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" onCreate={onCreate} />);

        fireEvent.change(target(), { target: { value: '12,345.67' } });
        expect(target().value).toBe('12345.67');

        fireEvent.click(save());
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
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" onCreate={onCreate} />);

        fireEvent.change(target(), { target: { value: '10' } });
        fireEvent.click(save());
        fireEvent.change(target(), { target: { value: '20' } });
        await act(async () => resolveSave());

        expect(target().value).toBe('20');
        expect(save()).toBeEnabled();
    });

    it('does not show a stale save failure after the input changes', async () => {
        let rejectSave;
        const onCreate = vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" onCreate={onCreate} />);

        fireEvent.change(target(), { target: { value: '10' } });
        fireEvent.click(save());
        fireEvent.change(target(), { target: { value: '20' } });
        await act(async () => rejectSave(new Error('Save failed')));

        expect(target().value).toBe('20');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(save()).toBeEnabled();
    });

    it('replaces backend details with actionable save wording', async () => {
        render(<PriceAlertForm
            initialChainId="bitcoin-mainnet"
            onCreate={vi.fn().mockRejectedValue(new Error('saveAlert: vault is required'))}
        />);

        fireEvent.change(target(), { target: { value: '10' } });
        fireEvent.click(save());

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the alert. Try again.");
        expect(screen.queryByText(/vault is required/)).toBeNull();
    });

    it('explains an invalid zero target on submit and does not create it', () => {
        const onCreate = vi.fn();
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" onCreate={onCreate} />);

        fireEvent.change(target(), { target: { value: '0' } });

        expect(save()).toBeEnabled();
        fireEvent.click(save());
        expect(screen.getByLabelText('Form errors')).toHaveTextContent('Enter a price greater than zero.');
        expect(target()).toHaveAttribute('aria-invalid', 'true');
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('prefills an edited alert, names the button Save Alert and submits the edit', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<PriceAlertForm
            initialAlert={{ chainId: 'bitcoin-mainnet', direction: 'below', targetFiat: 65000 }}
            fiatCurrency="eur"
            onCreate={onCreate}
        />);

        expect(direction()).toHaveAccessibleName('When the price: Falls below');
        expect(target().value).toBe('65000');

        fireEvent.change(target(), { target: { value: '64000' } });
        fireEvent.click(save('Save Alert'));

        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            direction: 'below',
            targetFiat: 64000,
            fiatCurrency: 'eur',
        }));
    });

    it('submits a priced token ticker and shows its current market price', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<PriceAlertForm
            initialChainId="bitcoin-mainnet"
            initialTick="XCHAIN"
            currentPrice={1.2}
            onCreate={onCreate}
        />);

        expect(screen.getByRole('button', { name: /^Asset: XCHAIN/ })).toBeTruthy();
        expect(screen.getByText('Now $1.2')).toBeTruthy();
        fireEvent.change(target(), { target: { value: '2' } });
        fireEvent.click(save());

        await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            tick: 'XCHAIN',
            direction: 'above',
            targetFiat: 2,
            fiatCurrency: 'usd',
        }));
    });

    it('explains why an unpriced token cannot have an alert', () => {
        const onCreate = vi.fn();
        render(<PriceAlertForm initialChainId="bitcoin-mainnet" initialTick="NOPRICE" onCreate={onCreate} />);

        fireEvent.change(target(), { target: { value: '1' } });
        fireEvent.click(save());
        const error = screen.getByLabelText('Form errors');
        expect(error).toHaveTextContent('NOPRICE has no market price yet. A price alert needs one.');
        expect(screen.getByRole('button', { name: /^Asset: NOPRICE/ })).toHaveAttribute('aria-invalid', 'true');
        expect(save()).toBeEnabled();
        expect(onCreate).not.toHaveBeenCalled();
    });

    it('keeps the Asset field off until a wallet can list its assets', () => {
        render(<PriceAlertForm onCreate={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Asset: Select an asset' })).toBeDisabled();
    });
});
