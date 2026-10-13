// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'bc1qbatchsender000000000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [FROM] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: FROM }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listActions: vi.fn().mockResolvedValue(['SEND', 'BROADCAST']),
        buildBatchCommand: vi.fn().mockResolvedValue({
            command: 'SEND|0|PEPE|1|alice;BROADCAST|0|1|hello',
            subStrings: ['SEND|0|PEPE|1|alice', 'BROADCAST|0|1|hello'],
        }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BatchComposerForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => cleanup());

describe('BatchComposerForm rows', () => {
    it('adds and removes stable action rows without allowing the last row to disappear', async () => {
        mount();
        const add = await screen.findByRole('button', { name: /Add action/ });
        expect(screen.getByTestId('batch-action-total')).toHaveTextContent('Batch total: 1 action');
        fireEvent.click(add);

        expect(screen.getAllByRole('group')).toHaveLength(2);
        expect(screen.getByTestId('batch-action-total')).toHaveTextContent('Batch total: 2 actions');
        const remove = screen.getAllByRole('button', { name: 'Remove' });
        expect(remove[0]).not.toBeDisabled();
        expect(remove[1]).not.toBeDisabled();
        fireEvent.click(remove[1]);
        expect(screen.getAllByRole('group')).toHaveLength(1);
        expect(screen.getByTestId('batch-action-total')).toHaveTextContent('Batch total: 1 action');
        expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    });

    it('shows validation beside the affected row and retracts it when the field is fixed', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: /Add action/ }));
        const rows = screen.getAllByRole('group');
        const second = within(rows[1]);

        expect(second.getByText('Step 2: pick an action.')).toBeInTheDocument();
        fireEvent.change(second.getByLabelText('Action'), { target: { value: 'SEND' } });
        expect(second.queryByText('Step 2: pick an action.')).toBeNull();

        fireEvent.change(second.getByLabelText('Params (JSON object)'), { target: { value: '{' } });
        expect(second.getByText(/Step 2: params JSON parse error/)).toBeInTheDocument();
        fireEvent.change(second.getByLabelText('Params (JSON object)'), {
            target: { value: '{"VERSION":"0"}' },
        });
        expect(second.queryByText(/Step 2:/)).toBeNull();
    });

    it('reviews every queued action and displays one batch network-fee selector', async () => {
        const messaging = mount();
        const firstAction = await screen.findByLabelText('Action');
        fireEvent.change(firstAction, { target: { value: 'SEND' } });
        fireEvent.click(screen.getByRole('button', { name: /Add action/ }));
        const actions = screen.getAllByLabelText('Action');
        fireEvent.change(actions[1], { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('SEND|0|PEPE|1|alice')).toBeInTheDocument();
        expect(screen.getByText('BROADCAST|0|1|hello')).toBeInTheDocument();
        expect(screen.getByTestId('batch-review-action-total')).toHaveTextContent('2 actions');
        expect(screen.getAllByText('Network fee')).toHaveLength(1);
    });
});
