// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Manage token's "You hold" stat reads the wallet's balance of the tick. A
// failed read, whole or for one address, leaves it unknown: it never reads
// as a zero holding and a 0.0% share of supply.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const MINE = 'bcrt1qmineminemineminemineminemineminemin0';
const SECOND = 'bcrt1qsecondsecondsecondsecondsecondsecon';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount(getWalletBalances) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: MINE, divisibility: 0, totalSupply: '1000' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: MINE }, { address: SECOND }] }),
        getWalletBalances,
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken walletId="wallet" chainId={CHAIN} tick="HOLDPROBE" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

function holdStat() {
    const label = screen.getByText('You hold');
    return label.parentElement;
}

function heldEntry(address, quantity) {
    return {
        address,
        error: null,
        balances: { native: null, tokens: [{ tick: 'HOLDPROBE', quantity, divisibility: 0 }] },
    };
}

describe('ManageToken You hold', () => {
    it('shows the holding once the read answers', async () => {
        mount(vi.fn().mockResolvedValue({ [CHAIN]: [heldEntry(MINE, '250')] }));
        await waitFor(() => expect(within(holdStat()).getByText('25.0% of supply')).toBeTruthy());
        expect(within(holdStat()).getByText('250')).toBeTruthy();
    });

    it('leaves the holding unknown when the read fails', async () => {
        const messaging = mount(vi.fn().mockRejectedValue(new Error('offline')));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        await screen.findByRole('region', { name: 'Token identity' });

        expect(within(holdStat()).getByText('-')).toBeTruthy();
        expect(within(holdStat()).queryByText(/% of supply/)).toBeNull();
    });

    it('leaves the holding unknown when one address failed to read', async () => {
        const messaging = mount(vi.fn().mockResolvedValue({
            [CHAIN]: [
                heldEntry(MINE, '250'),
                { address: SECOND, balances: null, error: 'explorer unreachable' },
            ],
        }));
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        await screen.findByRole('region', { name: 'Token identity' });

        expect(within(holdStat()).getByText('-')).toBeTruthy();
        expect(within(holdStat()).queryByText('250')).toBeNull();
        expect(within(holdStat()).queryByText(/% of supply/)).toBeNull();
    });
});
