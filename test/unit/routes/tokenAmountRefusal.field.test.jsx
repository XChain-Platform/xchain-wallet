// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Mint and Destroy refuse a malformed amount under the Amount field and move
// focus there. On a phone the Mint or Destroy button sits below the fold of a
// long form, so a refusal drawn only in the page notice at the top leaves the
// press looking like it did nothing.

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
const SHAPE = 'Write the amount with digits on both sides of the decimal point, such as 0.5.';

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
])('%s amount refusal', (_name, Form, buttonName) => {
    it('shows once under the Amount field, focuses it and clears on the next edit', async () => {
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
        const amount = await screen.findByLabelText(/^Amount\b/);
        fireEvent.change(amount, { target: { value: '.' } });
        const submit = screen.getByRole('button', { name: buttonName });
        submit.focus();
        fireEvent.click(submit);

        expect(await screen.findByText(SHAPE)).toBeInTheDocument();
        expect(screen.getAllByText(SHAPE)).toHaveLength(1);
        expect(amount).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(amount);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(amount, { target: { value: '0.5' } });
        expect(screen.queryByText(SHAPE)).toBeNull();
    });
});
