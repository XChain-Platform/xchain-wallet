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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function mount(initialRows = [{ chainId: CHAIN_ID, action: 'SEND', params: { VERSION: '0' } }]) {
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
                initialRows={initialRows}
            />
        </MessagingProvider>,
    );
}

describe('ParallelComposer row editor', () => {
    it('shows the network once, in the Network field, with no trailing badge', async () => {
        mount();
        const form = await screen.findByRole('form', { name: 'Compose parallel actions' });
        await screen.findByRole('button', { name: 'Remove' });
        expect(screen.getByRole('combobox', { name: 'Network' })).toBeTruthy();
        expect(form.querySelectorAll(`.${badgeStyles.badge}`)).toHaveLength(0);
    });

    it('waits to ask for an action until the user touches the row or presses Review', async () => {
        mount(null);
        const review = await screen.findByRole('button', { name: 'Review' });
        expect(screen.queryByText(/pick an action/)).toBeNull();
        expect(review).not.toBeDisabled();

        fireEvent.click(review);
        expect(await screen.findByText('Row 1: pick an action.')).toBeTruthy();
        expect(review).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: /Add action/ }));
        fireEvent.change(screen.getAllByRole('combobox', { name: 'Action' })[0], { target: { value: 'SEND' } });
        expect(screen.queryByText(/pick an action/)).toBeNull();

        fireEvent.change(screen.getAllByRole('textbox', { name: 'Params (JSON object)' })[1], {
            target: { value: '{"VERSION":"0","MEMO":"x"}' },
        });
        expect(screen.getByText('Row 2: pick an action.')).toBeTruthy();
    });
});
