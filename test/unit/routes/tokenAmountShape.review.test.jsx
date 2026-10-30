// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The amount field lets a user type a lone '.', '.5' or '5.'. Mint and
// Destroy used to test positivity with Number(amount) <= 0, and
// Number('.') is NaN, so a lone '.' went to compose as the action amount.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
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

function messagingFor(tick) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick, divisibility: 8, locks: {}, maxSupply: '5000', totalSupply: '1',
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick, quantity: '1000', divisibility: 8 }],
                },
            }],
        }),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        preflight: vi.fn(),
    };
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe.each([
    ['Mint', MintForm, /^(Mint|Preview)$/],
    ['Destroy', DestroyForm, /^Destroy$/],
])('%s amount shape', (_name, Form, buttonName) => {
    it.each(['.', '.5', '5.'])('refuses %j before composing', async (typed) => {
        const messaging = messagingFor('ART');
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Form
                    walletId="w"
                    initialChainId={CHAIN}
                    initialTick="ART"
                    initialFromAddress={SOURCE.address}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText(/^Amount\b/), { target: { value: typed } });
        fireEvent.click(screen.getByRole('button', { name: buttonName }));

        const alerts = await screen.findAllByRole('alert');
        expect(alerts.map((a) => a.textContent).join(' ')).toMatch(
            /positive number|digits on both sides of the decimal point/,
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
