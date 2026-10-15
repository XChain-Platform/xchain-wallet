// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each parallel row ended with a lone coin icon under its Remove button. It
// was the chain badge left behind once badges stopped printing the chain
// name: it repeated the Chain field directly above it and, with no text,
// read as an unexplained mark. The editor no longer renders it; the review
// list keeps its Chain row.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';
import badgeStyles from '../../../packages/core/src/ui/ChainBadge.module.css';

const CHAIN_ID = 'bitcoin-regtest';
const FROM = {
    id: 'address-1',
    address: 'bc1qparallelfromaddress000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: FROM })),
        listActions: vi.fn(async () => ['SEND']),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={() => {}}
                initialRows={[{ chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0' } }]}
            />
        </MessagingProvider>,
    );
}

describe('ParallelComposer row editor', () => {
    it('shows the chain once, in the Chain field, with no trailing badge', async () => {
        mount();
        const form = await screen.findByRole('form', { name: 'Compose parallel actions' });
        await screen.findByRole('button', { name: 'Remove' });
        expect(screen.getByRole('combobox', { name: 'Chain' })).toBeTruthy();
        expect(form.querySelectorAll(`.${badgeStyles.badge}`)).toHaveLength(0);
    });
});
