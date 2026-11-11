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
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

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
    it('uses the network picker and named icon actions', async () => {
        mount();
        const form = await screen.findByRole('form', { name: 'Compose parallel actions' });
        const network = screen.getByRole('button', { name: /^Network:/ });
        const add = screen.getByRole('button', { name: 'Add action' });
        const remove = screen.getByRole('button', { name: 'Remove' });
        const submit = screen.getByRole('button', { name: 'Sign and send queue' });
        expect(screen.queryByRole('combobox', { name: 'Network' })).toBeNull();
        expect(network).toHaveAttribute('aria-haspopup', 'dialog');
        expect(form.querySelectorAll(`.${badgeStyles.badge}`)).toHaveLength(0);
        expect(add.querySelector('svg')).not.toBeNull();
        expect(remove.querySelector('svg')).not.toBeNull();
        expect(submit.querySelector('svg')).not.toBeNull();
        expect(submit).toHaveClass(buttonStyles.success);
    });

    it('gives every editable row field page-specific help', async () => {
        mount();
        await screen.findByRole('form', { name: 'Compose parallel actions' });

        expect(screen.queryByRole('button', { name: 'About action queue' })).toBeNull();
        expect(screen.getByRole('button', { name: 'About From' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Action' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'About Params (JSON object)' })).toBeTruthy();
        expect(screen.getByText('The wallet address that signs this row and pays its network fee.')).toBeTruthy();
        expect(screen.getByText(/^The raw action this row sends\./)).toBeTruthy();
        expect(screen.getByText("A JSON object containing this action's fields, using the same format as Advanced action.")).toBeTruthy();
        expect(screen.getByText(/queue is not atomic/)).toBeTruthy();
    });

    it('waits to ask for an action until the user touches the row or submits the queue', async () => {
        mount(null);
        const review = await screen.findByRole('button', { name: 'Sign and send queue' });
        expect(screen.queryByText(/pick an action/)).toBeNull();
        expect(review).not.toBeDisabled();

        fireEvent.click(review);
        expect(await screen.findByText('Row 1: pick an action.')).toBeTruthy();
        expect(review).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
        fireEvent.change(screen.getAllByRole('combobox', { name: 'Action' })[0], { target: { value: 'SEND' } });
        expect(screen.queryByText(/pick an action/)).toBeNull();

        fireEvent.change(screen.getAllByRole('textbox', { name: 'Params (JSON object)' })[1], {
            target: { value: '{"VERSION":"0","MEMO":"x"}' },
        });
        expect(screen.getByText('Row 2: pick an action.')).toBeTruthy();
    });
});
