// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mountDestroy({ balance = '2', divisibility = 0, initialTick = 'ART', otherBalance = null, walletMode = 'full' } = {}) {
    const composeForConfirm = vi.fn(() => new Promise(() => {}));
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN,
            tick: initialTick,
            divisibility,
            locks: {},
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [
                ...(otherBalance === null ? [] : [{
                    address: 'bc1qotherotherotherotherotherotherother',
                    balances: {
                        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                        tokens: [{ tick: initialTick, quantity: otherBalance, divisibility }],
                    },
                }]),
                {
                    address: SOURCE.address,
                    balances: {
                        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                        tokens: [{ tick: initialTick, quantity: balance, divisibility }],
                    },
                },
            ],
        }),
        composeForConfirm,
        preflight: vi.fn(),
    };
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DestroyForm
                walletId="w"
                initialChainId={CHAIN}
                initialTick={initialTick}
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
    resetWalletModes();
});

async function advanceBalanceLookup(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('DestroyForm amount validation', () => {
    it('uses Confirm Standard for watcher review and keeps the DESTROY gate', async () => {
        mountDestroy({ walletMode: 'watcher' });
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));

        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-buttons')).toHaveTextContent('RejectApprove');
        // G130: Approve keeps its colour; a tap before DESTROY is typed says
        // why at the top of the page.
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(screen.getByTestId('confirm-blocked')).toHaveTextContent('Finish the step above Approve, then approve.');
        expect(document.body.textContent).not.toMatch(/Estimate unavailable/);
        fireEvent.change(screen.getByRole('textbox', { name: /Type "DESTROY" to confirm/ }), { target: { value: 'DESTROY' } });
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();
        expect(screen.queryByTestId('confirm-blocked')).toBeNull();
    });

    it('renders form-specific help for its network and token fields', async () => {
        mountDestroy({ initialTick: null });

        // Network sits in the closed standard From section.
        fireEvent.click(await screen.findByRole('button', { name: /^From / }));
        expect(await screen.findByRole('button', { name: 'About Network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Token' })).toBeInTheDocument();
    });

    it('keeps a lowercase managed ticker exact in the destroy action', async () => {
        const composeForConfirm = mountDestroy({ initialTick: 'caseSensitive' });
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
        const params = composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.TICK).toBe('caseSensitive');
    });

    it('rejects decimals for an indivisible token before review', async () => {
        // The field knows the token's precision, so it refuses the fraction
        // as it is typed (U61), holds Destroy, and never composes.
        const composeForConfirm = mountDestroy();
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1.5' } });
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));

        expect(await screen.findByText(/Amount must be a whole number because ART is indivisible\.|Amount can have at most 0 decimal places\./))
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

    it.each([
        ['divisible', '1234567891', 8, '12.34567891', '12.34567891'],
        ['indivisible', '1234567891', 0, '1234567891', '1,234,567,891'],
    ])('Max fills the selected address full %s-token balance exactly', async (
        _kind, balance, divisibility, expected, displayed,
    ) => {
        const composeForConfirm = mountDestroy({
            balance,
            divisibility,
            otherBalance: '999999999999999999',
        });
        expect(await screen.findByText(`${displayed} ART available`))
            .toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Use max available amount' }));
        expect(screen.getByLabelText(/^Amount/)).toHaveValue(displayed);
        fireEvent.click(screen.getByRole('button', { name: /^Destroy$/ }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
        expect(composeForConfirm.mock.calls[0][0].actionData.params.AMOUNT).toBe(expected);
    });
});
