// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ chainId: 'bitcoin-mainnet', tick: 'BETA' })}>
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-a', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};

afterEach(() => {
    vi.useRealTimers();
    cleanup();
    __clearTokenInfoCache();
});

function localInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

describe('swap form expiration at review time', () => {
    it('refuses a custom expiration that passed while the form sat open', async () => {
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getWalletBalances: vi.fn().mockResolvedValue({
                [BTC]: [{ address: ADDRESS.address, balances: { tokens: [{ tick: 'ALPHA', quantity: '100.0', divisibility: 8 }] } }],
            }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8, creator: ADDRESS.address }),
            composeForConfirm,
        };
        const messaging = new Proxy(base, {
            get: (t, p) => (p in t ? t[p] : vi.fn().mockResolvedValue(null)),
        });
        render(
            <MessagingProvider shell="desktop" messaging={messaging}>
                <SwapForm walletId="w" onBack={() => {}} initialChainId={BTC} initialGiveTick="ALPHA" />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /Get token:/ });
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
        fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Expire at a specific time' }));

        const now = Date.now();
        fireEvent.change(screen.getByLabelText('Expires'), { target: { value: localInput(new Date(now + 5 * 60_000)) } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled());

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now + 60 * 60_000);
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(composeForConfirm).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/future date and time/i));
    });
});
