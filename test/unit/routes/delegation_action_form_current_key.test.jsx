// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ACTIVE_KEY = 'a'.repeat(64);
const HISTORICAL_KEY = 'b'.repeat(64);

function mountForm() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1',
                address: ADDRESS,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getDelegationsForAddress: vi.fn().mockResolvedValue([
            {
                action_index: 20,
                signing_pubkey: HISTORICAL_KEY,
                status: 'valid',
                activation_block: 20,
                deactivation_block: 90,
            },
            {
                action_index: 10,
                signing_pubkey: ACTIVE_KEY,
                status: 'valid',
                activation_block: 40,
                deactivation_block: null,
            },
        ]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return () => Promise.resolve({});
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DelegationActionForm
                mode="revoke"
                walletId="wallet-1"
                chainId={CHAIN}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('DelegationActionForm current delegation prefill', () => {
    it('prefills the tip-effective key instead of newer historical creation rows', async () => {
        mountForm();

        await waitFor(() => {
            expect(screen.getByLabelText('Signing pubkey to revoke')).toHaveValue(ACTIVE_KEY);
        });
        expect(screen.getByLabelText('Signing pubkey to revoke')).not.toHaveValue(HISTORICAL_KEY);
    });
});
