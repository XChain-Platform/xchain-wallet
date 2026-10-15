// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mountDestroy({ balance = '2', divisibility = 0 } = {}) {
    const composeForConfirm = vi.fn();
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN,
            tick: 'ART',
            divisibility,
            locks: {},
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'ART', quantity: balance, divisibility }],
                },
            }],
        }),
        composeForConfirm,
        preflight: vi.fn(),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DestroyForm
                walletId="w"
                initialChainId={CHAIN}
                initialTick="ART"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return composeForConfirm;
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    __clearTokenInfoCache();
});

async function advanceBalanceLookup(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('DestroyForm amount validation', () => {
    it('rejects decimals for an indivisible token before review', async () => {
        const composeForConfirm = mountDestroy();
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1.5' } });
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));

        expect(await screen.findByText('Amount must be a whole number because ART is indivisible.'))
            .toBeInTheDocument();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('names the available balance and refuses an over-burn', async () => {
        vi.useFakeTimers();
        const composeForConfirm = mountDestroy();
        await advanceBalanceLookup(0);
        await advanceBalanceLookup(399);
        expect(document.body.textContent).not.toContain('2 ART available');
        await advanceBalanceLookup(1);
        expect(document.body.textContent).toContain('2 ART available');
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));

        expect(screen.getByText(
            'This address holds only 2 ART. Enter an amount at or below that balance.',
        )).toBeInTheDocument();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
