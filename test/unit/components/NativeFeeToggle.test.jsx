// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NativeFeeToggle } from '../../../packages/core/src/shared/components/NativeFeeToggle.jsx';

afterEach(() => cleanup());

describe('NativeFeeToggle', () => {
    it('renders a plain-language label naming the coin when coinTicker is set', () => {
        render(<NativeFeeToggle checked={false} onChange={() => {}} coinTicker="BTC" />);
        expect(screen.getByText('Pay protocol fee in BTC instead of XCHAIN')).toBeTruthy();
        // The forfeiture hint is surfaced inline.
        expect(screen.getByText(/not refunded if the network rejects/i)).toBeTruthy();
    });

    it('renders nothing when coinTicker is empty (unknown/custom chain)', () => {
        const { container } = render(
            <NativeFeeToggle checked={false} onChange={() => {}} coinTicker="" />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('reflects the checked state and reports toggles via onChange', () => {
        const onChange = vi.fn();
        render(<NativeFeeToggle checked={false} onChange={onChange} coinTicker="DOGE" />);
        const sw = screen.getByRole('switch');
        expect(sw.checked).toBe(false);
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    // : on a chain with no XCHAIN fee lane there is nothing to choose
    // between, and a switch the user could untick produced a transaction the
    // network rejects after the miner fee was already spent.
    it('states the fee rather than offering a switch when mandatory', () => {
        render(<NativeFeeToggle checked mandatory onChange={() => {}} coinTicker="LTC" />);
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByText(/only way to pay a protocol fee on this chain/i)).toBeTruthy();
        // The fee is still a real on-chain payment, so the forfeit warning stays.
        expect(screen.getByText(/not refunded if the network rejects/i)).toBeTruthy();
    });

    it('still renders nothing on an unknown chain even when mandatory is passed', () => {
        const { container } = render(
            <NativeFeeToggle checked mandatory onChange={() => {}} coinTicker="" />,
        );
        expect(container.firstChild).toBeNull();
    });

    // . The row mounts on far more actions than the schedule prices, and
    // an unquoted one used to be told a fee would be spent and forfeited.
    describe(' it does not promise a fee it has not been given', () => {
        it('speaks conditionally on LTC when the form holds no quote', () => {
            render(<NativeFeeToggle checked mandatory onChange={() => {}} coinTicker="LTC" />);
            expect(screen.getByText('Protocol fees are paid in LTC')).toBeTruthy();
            expect(screen.getByText(/If this action charges one/)).toBeTruthy();
            // The old sentence asserted a charge on BROADCAST, MINT, SLEEP and
            // every other unpriced action.
            expect(screen.queryByText('Protocol fee is paid in LTC')).toBeNull();
        });

        it('says the action is free when the quote prices it at zero', () => {
            render(
                <NativeFeeToggle
                    checked mandatory onChange={() => {}} coinTicker="LTC"
                    fee={{ free: true, fee: '0.00000000' }}
                />,
            );
            expect(screen.getByText('This action has no protocol fee')).toBeTruthy();
            expect(screen.queryByText(/not refunded/i)).toBeNull();
        });

        it('drops the Bitcoin payment-mode switch too when the fee is zero', () => {
            render(
                <NativeFeeToggle
                    checked={false} onChange={() => {}} coinTicker="BTC" fee="0.00000000"
                />,
            );
            expect(screen.queryByRole('switch')).toBeNull();
            expect(screen.getByText('This action has no protocol fee')).toBeTruthy();
        });

        it('states the exact charge, definitely, when the quote carries one', () => {
            render(
                <NativeFeeToggle
                    checked mandatory onChange={() => {}} coinTicker="LTC"
                    fee={{ free: false, fee: '0.16500000' }}
                />,
            );
            expect(screen.getByText('Protocol fee is paid in LTC')).toBeTruthy();
            expect(screen.getByText(/protocol fee is 0\.165 XCHAIN/)).toBeTruthy();
            expect(screen.getByText(/not refunded if the network rejects/i)).toBeTruthy();
        });
    });
});
