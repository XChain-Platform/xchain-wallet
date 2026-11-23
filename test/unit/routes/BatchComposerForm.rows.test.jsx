// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { selectOption } from '../../helpers/selectOption.js';
import { slowTimeout } from '../../helpers/testEnvSpeed.js';

const CHAIN = 'bitcoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'bc1qbatchsender000000000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

// `walletMode` is the mode of wallet-1, published the way the shell does from
// the wallet list; every other override is a messaging method.
function mount({ walletMode = 'full', ...overrides } = {}) {
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
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

afterEach(() => { cleanup(); resetWalletModes(); });

describe('BatchComposerForm rows', () => {
    it('shows compose fees, field help, and ruled action buttons', async () => {
        const quoteProtocolFee = vi.fn().mockResolvedValue({ xchainFee: '0.064', requiredFeeSats: 197 });
        mount({ quoteProtocolFee });

        // No page-level From section: the transaction's own From row names
        // its address (layout 1).
        const fromRow = await screen.findByRole('button', { name: 'Change the network and From address of transaction 1' });
        expect(within(fromRow).getByLabelText(FROM.address)).toBeInTheDocument();
        expect(screen.queryByLabelText('From address')).toBeNull();
        expect(screen.getByText('One sub-action included in this single BATCH transaction.')).toBeInTheDocument();
        expect(screen.getByText("This action's fields, entered as a JSON object.")).toBeInTheDocument();
        expect(screen.getByText('Protocol fee')).toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: /Pay protocol fee in/, hidden: true })).toBeNull();

        const batch = screen.getByRole('button', { name: 'Review 1 Transaction' });
        // Add action is a plain row with a bare icon, never a button inside a row.
        const add = screen.getByRole('button', { name: /^Add action/ });
        expect(batch.className).toMatch(/success/);
        expect(batch.querySelector('[data-xc-icon]')).toBeTruthy();
        expect(add.querySelector('svg')).toBeTruthy();
        expect(add.className).not.toMatch(/danger|secondary/);

        selectOption(screen.getByRole('combobox', { name: 'Action' }), 'BROADCAST');
        await waitFor(() => expect(quoteProtocolFee).toHaveBeenCalledWith({
            chainId: CHAIN,
            source: FROM.address,
            actionData: {
                action: 'BATCH',
                params: { VERSION: '0', COMMAND: 'SEND|0|PEPE|1|alice;BROADCAST|0|1|hello' },
            },
        }));
    });

    it('names the batch action in watcher mode', async () => {
        mount({
            walletMode: 'watcher',
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'aa00' }),
        });
        await screen.findByRole('combobox', { name: 'Action' });

        expect(screen.getByRole('button', { name: 'Review 1 Transaction' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^(Preview|Review)$/ })).toBeNull();
    });

    it('shows no batch limits block; the limit appears only when the last row is reached', async () => {
        mount();

        await screen.findByRole('combobox', { name: 'Action' });
        expect(screen.queryByText('Batch limits')).toBeNull();
        expect(document.querySelector('details')).toBeNull();
        expect(screen.queryByText(/actions is the most one batch carries/)).toBeNull();
    });

    it('adds and removes stable action rows without allowing the last row to disappear', async () => {
        mount();
        // One transaction with one action offers nothing to remove.
        await screen.findByRole('region', { name: 'Action 1' });
        expect(screen.queryByRole('button', { name: /^Remove action/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Remove transaction/ })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /^Add action/ }));
        expect(screen.getAllByRole('region', { name: /Action \d/ })).toHaveLength(2);
        // Each open action carries its own Remove action row.
        const remove = screen.getAllByRole('button', { name: /^Remove action/ });
        expect(remove).toHaveLength(2);
        expect(within(screen.getByRole('region', { name: 'Action 2' })).getByRole('button', { name: /^Remove action/ })).toBe(remove[1]);
        fireEvent.click(remove[1]);
        expect(screen.getAllByRole('region', { name: /Action \d/ })).toHaveLength(1);
        expect(screen.queryByRole('button', { name: /^Remove action/ })).toBeNull();
    });

    it('stops offering Add action once the batch holds the maximum number of actions', async () => {
        const { flows } = await import('../../../packages/core/src/index.js');
        expect(typeof flows.BATCH_MAX_COMMANDS).toBe('number');

        mount();
        const add = await screen.findByRole('button', { name: /^Add action/ });
        for (let i = 1; i < flows.BATCH_MAX_COMMANDS; i += 1) fireEvent.click(add);

        expect(screen.getAllByRole('region', { name: /Action \d/ })).toHaveLength(flows.BATCH_MAX_COMMANDS);
        expect(add).toBeDisabled();
        expect(screen.getByText(new RegExp(`${flows.BATCH_MAX_COMMANDS} actions is the most one batch carries`))).toBeTruthy();
    // 249 clicks, each re-rendering a longer list: about 20s on a dev box, and
    // instrumentation plus a shared runner more than doubled it past 60s.
    }, slowTimeout(60000));

    it('waits to ask for an action until the user touches the row or presses Batch', async () => {
        mount();
        const review = await screen.findByRole('button', { name: 'Review 1 Transaction' });
        expect(screen.queryByText(/pick an action/)).toBeNull();
        expect(review).not.toBeDisabled();

        fireEvent.click(review);
        expect(within(screen.getByLabelText('Form errors')).getByText('Step 1: pick an action.')).toBeInTheDocument();
        expect(review).not.toBeDisabled();
        expect(screen.getByRole('combobox', { name: 'Action' })).toHaveAttribute('aria-invalid', 'true');

        fireEvent.click(screen.getByRole('button', { name: /^Add action/ }));
        const rows = screen.getAllByRole('region', { name: /Action \d/ });
        expect(within(rows[1]).queryByText(/pick an action/)).toBeNull();
        fireEvent.change(within(rows[1]).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TEXT":"hi"}' },
        });
        expect(within(rows[1]).getByText('Step 2: pick an action.')).toBeInTheDocument();
    });

    it('shows validation beside the affected row and retracts it when the field is fixed', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: /^Add action/ }));
        const rows = screen.getAllByRole('region', { name: /Action \d/ });
        const second = within(rows[1]);

        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));
        expect(second.getByText('Step 2: pick an action.')).toBeInTheDocument();
        selectOption(second.getByRole('combobox', { name: 'Action' }), 'SEND');
        expect(second.queryByText('Step 2: pick an action.')).toBeNull();

        fireEvent.change(second.getByRole('textbox', { name: 'Params (JSON object)' }), { target: { value: '{' } });
        expect(second.getByText(/Step 2: Params JSON is not valid/)).toBeInTheDocument();
        fireEvent.change(second.getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0"}' },
        });
        expect(second.queryByText(/Step 2:/)).toBeNull();
    });

    it('reviews every queued action and reads the batch fees back without a second picker', async () => {
        const messaging = mount();
        const firstAction = await screen.findByRole('combobox', { name: 'Action' });
        selectOption(firstAction, 'SEND');
        fireEvent.click(screen.getByRole('button', { name: /^Add action/ }));
        const actions = screen.getAllByRole('combobox', { name: 'Action' });
        selectOption(actions[1], 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        await waitFor(() => expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('SEND|0|PEPE|1|alice')).toBeInTheDocument();
        expect(screen.getByText('BROADCAST|0|1|hello')).toBeInTheDocument();
        // The speed and any custom fee are picked only in the compose form's
        // Speed and Fees section (G113); the review reads the fees back with
        // their Total and draws no slider or fee input of its own.
        expect(screen.queryAllByRole('slider')).toHaveLength(0);
        expect(screen.queryByRole('textbox', { name: /Network fee amount|Custom fee rate/ })).toBeNull();
        expect(document.querySelector('[data-fees-row="network"]')).toHaveTextContent('Network fee');
        expect(document.querySelector('[data-fees-row="total"]')).toBeInTheDocument();
    });

    it('answers a missing signing password without disabling Sign Batch', async () => {
        const advancedAction = vi.fn();
        const messaging = mount({
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            advancedAction,
        });
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        const sign = await screen.findByRole('button', { name: 'Sign Batch' });
        expect(sign).not.toBeDisabled();
        fireEvent.click(sign);

        expect(await within(screen.getByLabelText('Form errors')).findByText('Enter your password to sign this batch.')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
        expect(advancedAction).not.toHaveBeenCalled();
        expect(messaging.buildActionPsbtRequest).toBeUndefined();
    });

    it('returns from review without resubmitting and preserves the batch rows', async () => {
        mount();
        const action = await screen.findByRole('combobox', { name: 'Action' });
        selectOption(action, 'SEND');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(await screen.findByText('SEND|0|PEPE|1|alice')).toBeInTheDocument();
        expect(fireEvent.click(screen.getByRole('button', { name: 'Back' }))).toBe(false);
        expect(await screen.findByRole('combobox', { name: 'Action' })).toHaveValue('SEND');
        expect(screen.getByRole('button', { name: 'Review 1 Transaction' })).toBeInTheDocument();
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
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(within(await screen.findByLabelText('Form errors')).getByText(`Step 1: ${message}`)).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Action 1' })).toBeInTheDocument();
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
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        const error = within(await screen.findByLabelText('Form errors')).getByText(/Step 1: Amount must be greater than zero/);
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
        const first = await screen.findByRole('region', { name: 'Action 1' });
        selectOption(within(first).getByRole('combobox', { name: 'Action' }), 'SEND');
        fireEvent.change(within(first).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"6.25","DESTINATION":"alice"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Add action/ }));
        const second = screen.getAllByRole('region', { name: /Action \d/ })[1];
        selectOption(within(second).getByRole('combobox', { name: 'Action' }), 'SEND');
        fireEvent.change(within(second).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"4","DESTINATION":"bob"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(await screen.findByText(/send 10\.25 PEPE in total, more than the 10 PEPE/)).toBeInTheDocument();
        expect(messaging.buildBatchCommand).not.toHaveBeenCalled();

        fireEvent.change(within(second).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"3.75","DESTINATION":"bob"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

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
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        const params = screen.getByRole('textbox', { name: 'Params (JSON object)' });
        fireEvent.change(params, { target: { value: '{"VERSION":"0","VALUE":"kept"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));
        await screen.findByText('BROADCAST|0|1|kept');

        fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);

        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByRole('textbox', { name: 'Params (JSON object)' })).toHaveValue('{"VERSION":"0","VALUE":"kept"}');
        expect(screen.getByRole('combobox', { name: 'Action' })).toHaveValue('BROADCAST');
    });

    it('refuses review when fresh balances cannot be loaded', async () => {
        const messaging = mount({ getAddressBalances: vi.fn().mockRejectedValue(new Error('offline')) });
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'SEND');
        fireEvent.change(screen.getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"1","DESTINATION":"alice"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(within(await screen.findByLabelText('Form errors')).getByText(/Couldn't refresh this address's balances/)).toBeInTheDocument();
        expect(messaging.buildBatchCommand).not.toHaveBeenCalled();
    });

    it('refuses review when the fresh token balance is unavailable', async () => {
        const messaging = mount({ getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '1', divisibility: 8 }, tokens: [], unavailable: ['tokens'],
        }) });
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'SEND');
        fireEvent.change(screen.getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"1","DESTINATION":"alice"}' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));
        expect(within(await screen.findByLabelText('Form errors')).getByText(/Couldn't refresh this address's balances/)).toBeInTheDocument();
        expect(screen.queryByText(/holds 0 PEPE/)).toBeNull();
        expect(messaging.buildBatchCommand).not.toHaveBeenCalled();
    });

    it('revalidates unchanged rows on every review and refuses data that has expired', async () => {
        const validateAction = vi.fn()
            .mockResolvedValueOnce({ valid: true, errors: [] })
            .mockResolvedValueOnce({ valid: false, errors: ['Quote expired. Refresh it and try again.'] });
        const messaging = mount({ validateAction });
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));
        await screen.findByText('BROADCAST|0|1|hello');
        fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(within(await screen.findByLabelText('Form errors')).getByText('Step 1: Quote expired. Refresh it and try again.')).toBeInTheDocument();
        expect(validateAction).toHaveBeenCalledTimes(2);
        expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1);
    });

    it('shows a plain retryable error when validation cannot refresh', async () => {
        const validateAction = vi.fn()
            .mockRejectedValueOnce(new Error('sdk.validateAction: RPC 503'))
            .mockResolvedValueOnce({ valid: true, errors: [] });
        const messaging = mount({ validateAction });
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(within(await screen.findByLabelText('Form errors')).getByText(/Couldn't validate every action/)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/sdk\.validateAction|RPC 503/);
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));
        expect(await screen.findByText('BROADCAST|0|1|hello')).toBeInTheDocument();
        expect(messaging.buildBatchCommand).toHaveBeenCalledTimes(1);
    });
});
