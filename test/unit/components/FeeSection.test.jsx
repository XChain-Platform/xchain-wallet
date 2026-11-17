// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one Fees section (operator ruling 2026-11-13): titled Fees, closed to
// "Normal · ~$0.45" (coin amounts with no price, a spinner while the protocol
// fee loads); open, the slider, the Network fee line, then a rule, the
// Protocol fee line and the pay-in-coin switch. No Total.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { FeeSection } from '../../../packages/core/src/shared/components/formStandard/FeeSection.jsx';

const useFeeFiatMock = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { fiatCurrency: 'USD' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: (...args) => useFeeFiatMock(...args),
}));

afterEach(() => {
    cleanup();
    useFeeFiatMock.mockReset();
});

const CHAIN = 'bitcoin-mainnet';
const estimate = (rateValue, coinAmount, etaMinutes) => ({
    rateValue, coinAmount, etaMinutes, rate: `${rateValue} sat/vB`, vsize: 140,
});
const TIERS = {
    low: estimate(1, '0.0000014', 60),
    normal: estimate(3, '0.0000042', 30),
    fast: estimate(6, '0.0000084', 10),
    unit: 'sat/vB',
};
// 10 XCHAIN, or 65 sats paid in the coin.
const QUOTE = { xchainFee: '10', requiredFeeSats: 65 };
const FIAT = {
    formatNativeFee: (amount) => ({ '0.0000042': '~$0.39', '0.00000065': '~$0.06' }[amount] || null),
    formatProtocolFee: (amount) => (amount === '10' ? '~$0.06' : null),
    formatFeeTotal: vi.fn(() => '~$0.45'),
};

function withMessaging(node) {
    return <MessagingContext.Provider value={{ shell: 'web', messaging: {} }}>{node}</MessagingContext.Provider>;
}

function summary(container) {
    return container.querySelector('[data-section-summary]');
}

function Host({ fees, ...props }) {
    const [value, setValue] = useState({ mode: 'normal' });
    return <FeeSection chainId={CHAIN} coinTicker="BTC" tiers={TIERS} value={value} onChange={setValue} fees={fees} {...props} />;
}

describe('FeeSection closed summary', () => {
    it('is titled Speed and Fees and reads the speed and the fee total in fiat', () => {
        useFeeFiatMock.mockReturnValue(FIAT);
        const { container } = render(withMessaging(
            <Host fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: false, onChange: vi.fn() } }} />,
        ));
        expect(container.querySelector('[data-form-section-title]')).toHaveTextContent(/^Speed and Fees$/);
        expect(summary(container)).toHaveTextContent(/^Normal · ~\$0\.45$/);
        // The network fee at the coin's rate plus the XCHAIN protocol fee at XCHAIN's.
        expect(FIAT.formatFeeTotal).toHaveBeenLastCalledWith({ native: ['0.0000042'], protocol: '10' });
        expect(screen.queryByText('Network fee', { selector: '[data-form-section-title]' })).toBeNull();
    });

    it('prices the protocol fee as coin when it is paid in the coin', () => {
        useFeeFiatMock.mockReturnValue(FIAT);
        render(withMessaging(
            <Host fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: true, onChange: vi.fn() } }} />,
        ));
        expect(FIAT.formatFeeTotal).toHaveBeenLastCalledWith({ native: ['0.0000042', '0.00000065'], protocol: null });
    });

    it('falls back to coin amounts with no price', () => {
        const { container } = render(
            <Host fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: false, onChange: vi.fn() } }} />,
        );
        expect(summary(container)).toHaveTextContent(/^Normal · 0\.0000042 BTC \+ 10 XCHAIN$/);
    });

    it('shows the network fee alone, unit kept apart, on a form with no protocol fee', () => {
        const { container } = render(<Host />);
        expect(summary(container)).toHaveTextContent(/^Normal · 0\.0000042 BTC$/);
        expect(summary(container).querySelector('[data-summary-unit]')).toHaveTextContent('BTC');
    });

    // The closed summary never spins (operator 2026-11-13): while the protocol
    // fee is pending it shows the speed and the network fee it already has.
    it('shows the speed and network fee, with no spinner, while the protocol fee is pending', () => {
        const { container } = render(<Host fees={{ quote: null, pending: true }} />);
        expect(summary(container).querySelector('[data-fee-summary-loading]')).toBeNull();
        expect(summary(container)).toHaveTextContent(/^Normal · 0\.0000042 BTC$/);
    });
});

describe('FeeSection opened', () => {
    it('shows the slider, the Network fee line, a rule, the Protocol fee line and the switch, in that order', () => {
        useFeeFiatMock.mockReturnValue(FIAT);
        const { container } = render(withMessaging(
            <Host defaultOpen fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: false, onChange: vi.fn() } }} />,
        ));
        const body = container.querySelector('[data-form-section="fee"] [id^="form-section-fee"]');
        const slider = within(body).getByRole('slider', { name: 'Network fee' });
        const network = body.querySelector('[data-fees-row="network"]');
        const rule = body.querySelector('hr');
        const protocol = body.querySelector('[data-fees-row="protocol"]');
        const toggle = within(body).getByRole('switch', { name: 'Pay protocol fee in BTC' });
        const order = [slider, network, rule, protocol, toggle];
        order.slice(1).forEach((el, i) => {
            expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });
        expect(network).toHaveTextContent(/^Network fee.*0\.0000042 BTC~\$0\.39$/);
        expect(protocol).toHaveTextContent(/^Protocol fee.*10 XCHAIN~\$0\.06$/);
        expect(body).not.toHaveTextContent('Total');
        // No nested card or second heading inside the section.
        expect(body.querySelector('[data-fees-card]')).toBeNull();
        expect(body.querySelector('h1, h2, h3, h4')).toBeNull();
    });

    it('puts the time under each speed stop, none on Custom and none above the slider', () => {
        const { container } = render(<Host defaultOpen />);
        const ticks = [...container.querySelectorAll('[data-active-speed] button[tabindex="-1"]')].map((b) => b.textContent);
        expect(ticks).toEqual(['Slow~60 min', 'Normal~30 min', 'Fast~10 min', 'Custom']);
        const slider = screen.getByRole('slider', { name: 'Network fee' });
        const body = slider.closest('[id^="form-section-fee"]');
        expect(body.firstElementChild.contains(slider)).toBe(true);
        expect(body.firstElementChild.firstElementChild.contains(slider)).toBe(true);
    });

    it('leaves out the protocol fee lines on an action without one', () => {
        const { container } = render(<Host defaultOpen />);
        expect(container.querySelector('[data-fees-row="network"]')).not.toBeNull();
        expect(container.querySelector('[data-fees-row="protocol"]')).toBeNull();
        expect(container.querySelector('hr')).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('keeps the Network fee help tip and gives the read-only Protocol fee line none (G121)', () => {
        render(<Host defaultOpen fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: false, onChange: vi.fn() } }} />);
        const networkHelp = screen.getByRole('button', { name: 'Network fee help' });
        expect(networkHelp.closest('[data-fees-row]')).toHaveAttribute('data-fees-row', 'network');
        expect(screen.queryByRole('button', { name: 'Protocol fee help' })).toBeNull();
    });

    it('shows the unverified-fee text as a static hint only for an unverified native fee', () => {
        const { container, unmount } = render(<Host defaultOpen fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: true, unverified: true, onChange: vi.fn() } }} />);
        const hint = container.querySelector('[data-fees-unverified-hint]');
        expect(hint).not.toBeNull();
        expect(hint.textContent).toMatch(/doesn't check contract actions in advance/);
        expect(hint.querySelector('button, svg')).toBeNull();
        unmount();
        const verified = render(<Host defaultOpen fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked: true, onChange: vi.fn() } }} />);
        expect(verified.container.querySelector('[data-fees-unverified-hint]')).toBeNull();
    });
});

describe('FeeSection pay-in-coin switch', () => {
    function SwitchHost({ mandatory = false, ticker = 'BTC' }) {
        const [checked, setChecked] = useState(false);
        return (
            <FeeSection
                defaultOpen
                chainId={CHAIN}
                coinTicker={ticker}
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                fees={{ quote: QUOTE, pending: false, nativeFeeProps: { checked, onChange: setChecked, mandatory } }}
            />
        );
    }

    it('shows the converted amount under its label while on', () => {
        useFeeFiatMock.mockReturnValue(FIAT);
        render(withMessaging(<SwitchHost />));
        const toggle = screen.getByRole('switch', { name: 'Pay protocol fee in BTC' });
        expect(toggle).not.toBeChecked();
        expect(screen.queryByText(/0\.00000065 BTC/)).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toBeChecked();
        expect(screen.getByText('0.00000065 BTC ~$0.06')).toBeInTheDocument();
        // The Protocol fee line still names the fee in XCHAIN.
        expect(document.querySelector('[data-fees-row="protocol"]')).toHaveTextContent('10 XCHAIN');
    });

    it('shows on and locked where the native output is the protocol fee', () => {
        render(<SwitchHost mandatory ticker="LTC" />);
        const toggle = screen.getByRole('switch', { name: 'Pay protocol fee in LTC' });
        expect(toggle).toBeChecked();
        expect(toggle).toBeDisabled();
        expect(screen.getByText('0.00000065 LTC')).toBeInTheDocument();
    });

    it('hides the switch when the action cannot pay in the coin', () => {
        render(<Host defaultOpen fees={{ quote: QUOTE, pending: false, nativeSwitch: false }} />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(document.querySelector('[data-fees-row="protocol"]')).toHaveTextContent('10 XCHAIN');
    });
});

describe('FeeSection fixed fee', () => {
    it('shows the Network fee line with no slider', () => {
        const { container } = render(<FeeSection defaultOpen chainId={CHAIN} coinTicker="BTC" fixedFee="0.0000042" />);
        expect(screen.queryByRole('slider')).toBeNull();
        expect(container.querySelector('[data-fees-row="network"]')).toHaveTextContent(/^Network fee.*0\.0000042 BTC$/);
        expect(summary(container)).toBeNull();
    });
});
