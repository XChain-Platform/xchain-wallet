// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: ({ chainId }) => ({
        formatNativeFee: () => chainId === 'bitcoin-mainnet' ? '~$0.42' : null,
    }),
}));

const TIERS = {
    unit: 'sat/vB',
    low: { rate: '1 sat/vB', rateValue: 1, coinAmount: '0.00000100', etaMinutes: 30, vsize: 100 },
    normal: { rate: '2 sat/vB', rateValue: 2, coinAmount: '0.00000200', etaMinutes: 10, vsize: 100 },
    fast: { rate: '3 sat/vB', rateValue: 3, coinAmount: '0.00000300', etaMinutes: 2, vsize: 100 },
};

// The wallet shell provides messaging; the price and settings hooks are mocked above.
function InShell({ children }) {
    return <MessagingContext.Provider value={{ messaging: {} }}>{children}</MessagingContext.Provider>;
}

beforeAll(() => {
    registerLocale('de-DE', {});
    registerLocale('fr-FR', {});
});

afterEach(async () => {
    await setLocale('en');
});

describe('<FeeSelector>', () => {
    it('renders an accessible preset slider and formatted estimate', () => {
        render(
            <FeeSelector
                chainId="bitcoin-mainnet"
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                label="Fee priority"
                coinTicker="BTC"
            />,
            { wrapper: InShell },
        );
        const slider = screen.getByRole('slider', { name: 'Network fee' });
        expect(slider).toHaveAttribute('aria-valuetext', 'Normal: 0.00000200 · ~10 min');
        expect(screen.getByRole('status')).toHaveTextContent('0.00000200 BTC');
        expect(screen.getByRole('status')).toHaveTextContent('~$0.42');
        expect(screen.getByRole('button', { name: 'Fee priority help' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit exact fee amount' }))
            .toHaveAttribute('title', 'Select to edit the exact fee');
        expect(screen.getByRole('button', { name: 'Edit fee rate (sat/vB)' }))
            .toHaveAttribute('title', 'Select to edit the fee rate');
    });

    it('emits preset and custom selections', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FeeSelector tiers={TIERS} value={{ mode: 'normal' }} onChange={onChange} />,
        );
        fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'fast' });
        fireEvent.click(document.querySelector('button[aria-label="Custom"]'));
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 2 });

        rerender(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'custom', customRate: 4 }}
                customEstimate={{ rate: '4 sat/vB', rateValue: 4, coinAmount: '0.00000400', vsize: 100 }}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByRole('textbox', { name: 'Custom fee rate (sat/vB)' }), {
            target: { value: '5.5' },
        });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5.5 });
    });

    it('supports exact-fee editing and converts coin amount to rate', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={onChange}
                coinTicker="BTC"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
        const amount = screen.getByRole('textbox', { name: 'Network fee amount (BTC)' });
        expect(amount).toHaveValue('0.00000200');
        fireEvent.change(amount, { target: { value: '0.000005' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5 });

        fireEvent.change(amount, { target: { value: '1,2,3' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0 });
        expect(amount).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('valid non-negative network fee');
    });

    it.each([
        ['de-DE', '2,75'],
        ['fr-FR', '2,75'],
    ])('parses a localized custom rate in %s without changing its numeric value', async (
        locale,
        localizedRate,
    ) => {
        await setLocale(locale);
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'custom', customRate: 2.5 }}
                customEstimate={{ rateValue: 2.5, coinAmount: '0.00000250', vsize: 100 }}
                onChange={onChange}
            />,
        );
        const input = screen.getByRole('textbox', { name: 'Custom fee rate (sat/vB)' });
        expect(input).toHaveValue('2,5');

        fireEvent.change(input, { target: { value: localizedRate } });

        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 2.75 });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
        const exactFee = screen.getByRole('textbox', { name: 'Network fee amount' });
        expect(exactFee).toHaveValue('0,00000250');
        fireEvent.change(exactFee, { target: { value: '0,000005' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5 });
    });

    it.each([
        ['5.123456789'],
        ['0.000000015'],
    ])('names a custom rate %j with more than 8 decimal places under the field', (typed) => {
        const tiers = { ...TIERS, minimumRate: 0, maximumRate: 1000 };
        render(
            <FeeSelector tiers={tiers} value={{ mode: 'custom', customRate: 2 }} onChange={() => {}} />,
        );
        const input = screen.getByRole('textbox', { name: 'Custom fee rate (sat/vB)' });
        fireEvent.change(input, { target: { value: typed } });

        expect(screen.getByRole('alert')).toHaveTextContent('Custom fee rate can have at most 8 decimal places.');
        expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('accepts a custom rate with exactly 8 decimal places', () => {
        render(
            <FeeSelector tiers={TIERS} value={{ mode: 'custom', customRate: 2 }} onChange={() => {}} />,
        );
        fireEvent.change(screen.getByRole('textbox', { name: 'Custom fee rate (sat/vB)' }), {
            target: { value: '2.12345678' },
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('opens on Custom with the chain unit when no estimate exists', () => {
        const onChange = vi.fn();
        const props = {
            chainId: 'dogecoin-mainnet',
            tiers: null,
            value: { mode: 'normal' },
            onChange,
            label: 'Fee',
        };
        const { rerender } = render(<FeeSelector {...props} />);
        expect(screen.queryByText(/Fee estimate unavailable/)).not.toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Custom fee rate (DOGE/kB)')).toBeInTheDocument();
        expect(screen.getByText('DOGE/kB')).toBeInTheDocument();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ mode: 'custom', customRate: undefined });

        rerender(<FeeSelector {...props} />);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('shows fiat for tier and Custom fees only on mainnet', () => {
        const { rerender } = render(
            <FeeSelector
                chainId="bitcoin-mainnet"
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
            />,
            { wrapper: InShell },
        );
        expect(screen.getByText('~$0.42')).toBeInTheDocument();

        rerender(
            <FeeSelector
                chainId="bitcoin-mainnet"
                tiers={TIERS}
                value={{ mode: 'custom', customRate: 4 }}
                customEstimate={{ rateValue: 4, coinAmount: '0.00000400', vsize: 100 }}
                onChange={() => {}}
            />,
        );
        expect(screen.getByText('~$0.42')).toBeInTheDocument();

        for (const chainId of ['bitcoin-testnet', 'bitcoin-regtest']) {
            rerender(
                <FeeSelector
                    chainId={chainId}
                    tiers={TIERS}
                    value={{ mode: 'normal' }}
                    onChange={() => {}}
                />,
            );
            expect(screen.queryByText('~$0.42')).not.toBeInTheDocument();
        }
    });

    it('shows no fiat and does not throw outside the wallet shell', () => {
        render(
            <FeeSelector
                chainId="bitcoin-mainnet"
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                coinTicker="BTC"
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('0.00000200 BTC');
        expect(screen.queryByText('~$0.42')).not.toBeInTheDocument();
    });

    it('renders bare without a settings provider or chain id', () => {
        render(<FeeSelector tiers={TIERS} value={{ mode: 'normal' }} onChange={() => {}} />);
        expect(screen.getByRole('slider', { name: 'Network fee' })).toBeInTheDocument();
        expect(screen.queryByText('~$0.42')).not.toBeInTheDocument();
    });

    it('removes custom controls and disables all choices when configured', () => {
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                allowCustom={false}
                disabled
            />,
        );
        expect(screen.getByRole('slider')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
        for (const name of ['Slow', 'Normal', 'Fast']) {
            expect(document.querySelector(`button[aria-label="${name}"]`)).toBeDisabled();
        }
    });
});
