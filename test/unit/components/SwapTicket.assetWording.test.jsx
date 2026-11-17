// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Trade page's swap ticket names its two chips by asset, never by token:
// a market pair can hold the network coin on either side.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SwapTicket } from '../../../packages/core/src/shared/components/marketTradeParts.jsx';

afterEach(cleanup);

describe('SwapTicket asset wording', () => {
    it('calls the pay and get chips assets when the pair includes the coin', () => {
        render(
            <SwapTicket
                side="buy"
                chainId="bitcoin-mainnet"
                payTick="BTC"
                getTick="PEPECASH"
                payValue=""
                getValue=""
                onPayChange={() => {}}
                onGetChange={() => {}}
                onSettle={() => {}}
                payBalance="Balance 0.5"
                onFlip={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Pay asset: BTC on Bitcoin' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Get asset: PEPECASH on Bitcoin' })).toBeTruthy();
        expect(screen.queryAllByRole('button', { name: /token/i })).toEqual([]);
    });
});
