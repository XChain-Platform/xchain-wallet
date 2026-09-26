// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const CHAIN = 'bitcoin-mainnet';

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'address-1',
                address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
                signerId: 'signer-1',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    };

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(cleanup);

describe('ListCreateForm accessibility', () => {
    it('explicitly associates the Addresses label with its textarea', async () => {
        mount();

        const textarea = await screen.findByRole('textbox', { name: 'Addresses' });
        const label = screen.getByText('Addresses', { selector: 'label' });

        expect(textarea.id).toBeTruthy();
        expect(label.htmlFor).toBe(textarea.id);
    });
});
