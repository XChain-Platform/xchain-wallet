// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Destroy Amount field shows the chosen token's exact format: an 8-place
// token pads "1" to "1.00000000" once the edit ends, a whole-number token
// refuses a fraction with a field error that also holds the Destroy button,
// and Max stays inside the field, disabled until a token is chosen. The form
// carries no irreversible notice (the confirm step says it), and the From
// label carries its help tip.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function mountDestroy({ divisibility = 8, initialTick = 'PADME', balance = '5' } = {}) {
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
            [CHAIN]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: initialTick ? [{ tick: initialTick, quantity: balance, divisibility }] : [],
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
                initialTick={initialTick}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return { messaging, composeForConfirm };
}

const amountField = () => screen.findByLabelText(/^Amount/);

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('DestroyForm amount format and help tips', () => {
    it('gives the From label its help tip and shows no irreversible notice on the form', async () => {
        mountDestroy();
        expect(await screen.findByRole('button', { name: 'About From' })).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('Destroy is irreversible');
    });

    it('pads a whole amount to an 8-place token once the edit ends', async () => {
        const { messaging } = mountDestroy({ divisibility: 8 });
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalled());
        const field = await amountField();
        fireEvent.change(field, { target: { value: '1' } });
        fireEvent.blur(field);
        await waitFor(() => expect(field.value).toBe('1.00000000'));
    });

    it('refuses a fraction for a whole-number token with a field error and holds Destroy', async () => {
        const { messaging, composeForConfirm } = mountDestroy({ divisibility: 0, initialTick: 'WHOLE' });
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalled());
        const field = await amountField();
        fireEvent.change(field, { target: { value: '1' } });
        fireEvent.blur(field);
        await waitFor(() => expect(field.value).toBe('1'));
        fireEvent.change(field, { target: { value: '1.5' } });
        expect(await screen.findByText(/whole number|decimal place/i)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: /^Destroy$/ })).toBeDisabled());
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('shows Max inside the field, disabled until a token is chosen', async () => {
        mountDestroy({ initialTick: '' });
        await amountField();
        expect(screen.getByRole('button', { name: 'Use max available amount' })).toBeDisabled();
    });
});
