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

function mount(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [FROM] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: FROM }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listActions: vi.fn().mockResolvedValue(['SEND', 'BROADCAST']),
        validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '100000000000', divisibility: 8 }],
        }),
        buildBatchCommand: vi.fn().mockResolvedValue({
            command: 'SEND|0|PEPE|1|alice;BROADCAST|0|1|hello',
            subStrings: ['SEND|0|PEPE|1|alice', 'BROADCAST|0|1|hello'],
        }),
        ...overrides,
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
    it('keeps batch limits in a collapsed disclosure', async () => {
        mount();

        const disclosure = (await screen.findByText('Batch limits')).closest('details');
        expect(disclosure).toHaveProperty('open', false);
        expect(disclosure).toHaveTextContent('Queue up to 250 actions from one address');
    });

    it('adds and removes stable action rows without allowing the last row to disappear', async () => {
        mount();
        const add = await screen.findByRole('button', { name: /Add action/ });
        fireEvent.click(add);

        expect(screen.getAllByRole('region', { name: /Step \d/ })).toHaveLength(2);
        const remove = screen.getAllByRole('button', { name: 'Remove' });
        expect(remove[0]).not.toBeDisabled();
        expect(remove[1]).not.toBeDisabled();
        fireEvent.click(remove[1]);
        expect(screen.getAllByRole('region', { name: /Step \d/ })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    });

    it('waits to ask for an action until the user touches the row or presses Review', async () => {
        mount();
        const review = await screen.findByRole('button', { name: 'Review' });
        expect(screen.queryByText(/pick an action/)).toBeNull();
        expect(review).not.toBeDisabled();

        fireEvent.click(review);
        expect(screen.getByText('Step 1: pick an action.')).toBeInTheDocument();
        expect(review).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: /Add action/ }));
        const rows = screen.getAllByRole('region', { name: /Step \d/ });
        expect(within(rows[1]).queryByText(/pick an action/)).toBeNull();
        fireEvent.change(within(rows[1]).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TEXT":"hi"}' },
        });
        expect(within(rows[1]).getByText('Step 2: pick an action.')).toBeInTheDocument();
    });

    it('shows validation beside the affected row and retracts it when the field is fixed', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: /Add action/ }));
        const rows = screen.getAllByRole('region', { name: /Step \d/ });
        const second = within(rows[1]);

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(second.getByText('Step 2: pick an action.')).toBeInTheDocument();
        fireEvent.change(second.getByRole('combobox', { name: 'Action' }), { target: { value: 'SEND' } });
        expect(second.queryByText('Step 2: pick an action.')).toBeNull();

        fireEvent.change(second.getByRole('textbox', { name: 'Params (JSON object)' }), { target: { value: '{' } });
        expect(second.getByText(/Step 2: Params JSON is not valid/)).toBeInTheDocument();
        fireEvent.change(second.getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0"}' },
        });
        expect(second.queryByText(/Step 2:/)).toBeNull();
    });

    it('reviews every queued action and displays one batch network-fee selector', async () => {
        const messaging = mount();
        const firstAction = await screen.findByRole('combobox', { name: 'Action' });
        fireEvent.change(firstAction, { target: { value: 'SEND' } });
        fireEvent.click(screen.getByRole('button', { name: /Add action/ }));
        const actions = screen.getAllByRole('combobox', { name: 'Action' });
        fireEvent.change(actions[1], { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('SEND|0|PEPE|1|alice')).toBeInTheDocument();
        expect(screen.getByText('BROADCAST|0|1|hello')).toBeInTheDocument();
        expect(screen.getAllByText('Network fee')).toHaveLength(1);
    });

    it('returns from review without resubmitting and preserves the batch rows', async () => {
        mount();
        const action = await screen.findByRole('combobox', { name: 'Action' });
        fireEvent.change(action, { target: { value: 'SEND' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('SEND|0|PEPE|1|alice')).toBeInTheDocument();
        expect(fireEvent.click(screen.getByRole('button', { name: 'Back' }))).toBe(false);
        expect(await screen.findByRole('combobox', { name: 'Action' })).toHaveValue('SEND');
        expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
        expect(screen.queryByText('SEND|0|PEPE|1|alice')).toBeNull();
    });

    it.each([
        ['an empty required field', 'Destination is required.'],
        ['zero', 'Amount must be greater than zero.'],
        ['a negative value', 'Amount cannot be negative.'],
        ['too many decimals', 'Amount has too many decimal places.'],
        ['a malformed address', 'Enter a valid destination address.'],
        ['a malformed ID', 'Order ID must be a whole number.'],
        ['an out-of-range number', 'Block height is outside the allowed range.'],
    ])('keeps %s out of review and shows the SDK message on its row', async (_case, message) => {
        const messaging = mount({
            validateAction: vi.fn().mockResolvedValue({ valid: false, errors: [{ message }] }),
        });
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(`Step 1: ${message}`)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Step 1' })).toBeInTheDocument();
        expect(messaging.buildBatchCommand).not.toHaveBeenCalled();
    });

    it('shows every field error returned for a row as plain copy', async () => {
        mount({
            validateAction: vi.fn().mockResolvedValue({
                valid: false,
                errors: [
                    { message: 'Amount must be greater than zero.', field: 'AMOUNT' },
                    { field: 'DESTINATION', code: 'BAD_ADDRESS' },
                ],
            }),
        });
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        const error = await screen.findByText(/Step 1: Amount must be greater than zero/);
        expect(error).toHaveTextContent('DESTINATION: enter a valid value.');
        expect(error.textContent).not.toMatch(/BAD_ADDRESS|\{.*\}/);
    });

    it('checks exact aggregate send totals against a fresh balance before review', async () => {
        const messaging = mount({
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 2 }],
            }),
            buildBatchCommand: vi.fn().mockResolvedValue({
                command: 'SEND|0|PEPE|6.25|alice;SEND|0|PEPE|3.75|bob',
                subStrings: ['not the command that will be signed'],
            }),
        });
        const first = await screen.findByRole('region', { name: 'Step 1' });
        fireEvent.change(within(first).getByRole('combobox', { name: 'Action' }), { target: { value: 'SEND' } });
        fireEvent.change(within(first).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"6.25","DESTINATION":"alice"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Add action/ }));
        const second = screen.getAllByRole('region', { name: /Step \d/ })[1];
        fireEvent.change(within(second).getByRole('combobox', { name: 'Action' }), { target: { value: 'SEND' } });
        fireEvent.change(within(second).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"4","DESTINATION":"bob"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(/send 10\.25 PEPE in total, more than the 10 PEPE/)).toBeInTheDocument();
        expect(messaging.buildBatchCommand).not.toHaveBeenCalled();

        fireEvent.change(within(second).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"3.75","DESTINATION":"bob"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('10.00 PEPE')).toBeInTheDocument();
        expect(screen.getByText('SEND|0|PEPE|6.25|alice')).toBeInTheDocument();
        expect(screen.getByText('SEND|0|PEPE|3.75|bob')).toBeInTheDocument();
        expect(screen.queryByText('not the command that will be signed')).toBeNull();
        expect(messaging.getAddressBalances).toHaveBeenCalledTimes(2);
    });

    it('uses review Back as draft editing and keeps all row values', async () => {
        const onBack = vi.fn();
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [FROM] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: FROM }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            listActions: vi.fn().mockResolvedValue(['BROADCAST']),
            validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
            buildBatchCommand: vi.fn().mockResolvedValue({ command: 'BROADCAST|0|1|kept' }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BatchComposerForm walletId="wallet-1" onBack={onBack} />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        const params = screen.getByRole('textbox', { name: 'Params (JSON object)' });
        fireEvent.change(params, { target: { value: '{"VERSION":"0","VALUE":"kept"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await screen.findByText('BROADCAST|0|1|kept');

        fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);

        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByRole('textbox', { name: 'Params (JSON object)' })).toHaveValue('{"VERSION":"0","VALUE":"kept"}');
        expect(screen.getByRole('combobox', { name: 'Action' })).toHaveValue('BROADCAST');
    });

    it('refuses review when fresh balances cannot be loaded', async () => {
        const messaging = mount({ getAddressBalances: vi.fn().mockRejectedValue(new Error('offline')) });
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'SEND' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"1","DESTINATION":"alice"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(/Couldn't refresh this address's balances/)).toBeInTheDocument();
        expect(messaging.buildBatchCommand).not.toHaveBeenCalled();
    });

    it('revalidates unchanged rows on every review and refuses data that has expired', async () => {
        const validateAction = vi.fn()
            .mockResolvedValueOnce({ valid: true, errors: [] })
            .mockResolvedValueOnce({ valid: false, errors: ['Quote expired. Refresh it and try again.'] });
        const messaging = mount({ validateAction });
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        await screen.findByText('BROADCAST|0|1|hello');
        fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText('Step 1: Quote expired. Refresh it and try again.')).toBeInTheDocument();
        expect(validateAction).toHaveBeenCalledTimes(2);
        expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1);
    });

    it('shows a plain retryable error when validation cannot refresh', async () => {
        const validateAction = vi.fn()
            .mockRejectedValueOnce(new Error('sdk.validateAction: RPC 503'))
            .mockResolvedValueOnce({ valid: true, errors: [] });
        const messaging = mount({ validateAction });
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        expect(await screen.findByText(/Couldn't validate every action/)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/sdk\.validateAction|RPC 503/);
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        expect(await screen.findByText('BROADCAST|0|1|hello')).toBeInTheDocument();
        expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1);
    });
});
