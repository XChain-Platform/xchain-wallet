// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'litecoin-mainnet';
const ADDRESS_A = {
    id: 'address-btc',
    address: 'bc1qbatchsender000000000000000000000000000',
    source: 'hd',
};
const ADDRESS_B = {
    id: 'address-ltc',
    address: 'ltc1qbatchsender00000000000000000000000000',
    source: 'hd',
};

// The picker stands in for the own-address screen: it switches to Litecoin
// and picks its address in one tap.
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onChainChange, onPick }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId}>
            <button
                type="button"
                onClick={() => {
                    onChainChange?.(CHAIN_B);
                    onPick(ADDRESS_B);
                }}
            >
                Pick Litecoin source
            </button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';

afterEach(() => cleanup());

function mount(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_A]: [ADDRESS_A], [CHAIN_B]: [ADDRESS_B] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listActions: vi.fn().mockResolvedValue(['SEND', 'BROADCAST']),
        validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '100000000000', divisibility: 8 }],
        }),
        buildBatchCommand: vi.fn(async ({ chainId }) => ({
            command: chainId === CHAIN_B ? 'BROADCAST|0|1|ltc' : 'BROADCAST|0|1|btc',
        })),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BatchComposerForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('BatchComposerForm grouped by transaction', () => {
    it('heads the first card with its From address and number, and reads each action as a sentence', async () => {
        mount();
        const cards = await screen.findByRole('list', { name: 'Transactions' });
        expect(within(cards).getByRole('button', { name: 'Change the network and From address of transaction 1' }))
            .toHaveTextContent('bc1q...0000');
        expect(within(cards).getByText('Transaction 1')).toBeTruthy();

        const row = screen.getByRole('region', { name: 'Action 1' });
        expect(within(row).getByText('Choose an action')).toBeTruthy();
        fireEvent.change(within(row).getByRole('combobox', { name: 'Action' }), { target: { value: 'SEND' } });
        fireEvent.change(within(row).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"250","DESTINATION":"bc1qdestination0000000000009cb2"}' },
        });
        expect(within(row).getByText('Send 250 PEPE')).toBeTruthy();
        expect(within(row).getByText('to bc1q...9cb2')).toBeTruthy();

        // Tapping the sentence folds its editor; tapping again opens it.
        const sentence = within(row).getByRole('button', { name: /Send 250 PEPE/ });
        expect(sentence).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(sentence);
        expect(within(row).queryByRole('combobox', { name: 'Action' })).toBeNull();
        fireEvent.click(sentence);
        expect(within(row).getByRole('combobox', { name: 'Action' })).toHaveValue('SEND');

        // The remove button is an icon labelled Remove; the first card keeps one action.
        expect(within(row).getByRole('button', { name: 'Remove' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Review 1 Transaction' })).toBeTruthy();
    });

    it('adds another network as a second card and reviews both transactions on their own chains', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });

        fireEvent.click(screen.getByRole('button', { name: 'Add Another Network' }));
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN_B);
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin source' }));

        const second = await screen.findByRole('list', { name: 'Actions in transaction 2' });
        fireEvent.change(within(second).getByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        expect(screen.getByText('Transaction 2')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Review 2 Transactions' }));

        await waitFor(() => expect(messaging.buildBatchCommand).toHaveBeenCalledWith({
            chainId: CHAIN_B,
            subActions: [{ action: 'BROADCAST', params: { VERSION: '0' } }],
        }));
        expect(messaging.validateAction).toHaveBeenCalledWith({ chainId: CHAIN_A, action: 'BROADCAST', params: { VERSION: '0' } });
        expect(messaging.validateAction).toHaveBeenCalledWith({ chainId: CHAIN_B, action: 'BROADCAST', params: { VERSION: '0' } });
        expect(await screen.findByText('BROADCAST|0|1|btc')).toBeTruthy();
        expect(screen.getByText('BROADCAST|0|1|ltc')).toBeTruthy();
        // The second transaction names its own From and its own network fee.
        const secondReview = screen.getByRole('region', { name: 'Transaction 2' });
        expect(secondReview).toHaveTextContent(/ltc1qb.*000000/);
        expect(secondReview).toHaveTextContent(/Network fee: [\d.]+ LTC/);
        // Separate transactions are not one unit, and the review says so.
        expect(screen.getByText(/These are 2 separate transactions, signed one after another/)).toBeTruthy();
    });

    it('signs the transactions one after another, each on its own chain and From', async () => {
        const calls = [];
        const target = {
            getAddressesByChain: () => Promise.resolve({ [CHAIN_A]: [ADDRESS_A], [CHAIN_B]: [ADDRESS_B] }),
            getActiveAddresses: () => Promise.resolve({}),
            getSettings: () => Promise.resolve({ walletMode: 'full' }),
            signerReady: () => Promise.resolve({ ready: true }),
            getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
            listActions: () => Promise.resolve(['BROADCAST']),
            validateAction: () => Promise.resolve({ valid: true, errors: [] }),
            buildBatchCommand: ({ chainId }) => Promise.resolve({
                command: chainId === CHAIN_B ? 'BROADCAST|0|1|ltc' : 'BROADCAST|0|1|btc',
            }),
            composeForConfirm: (args) => {
                calls.push({ method: 'composeForConfirm', args });
                return Promise.resolve({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
            },
            preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
            advancedAction: (args) => {
                calls.push({ method: 'advancedAction', args });
                return Promise.resolve({ txid: `tx-${args.chainId}` });
            },
        };
        const messaging = new Proxy(target, {
            get(t, prop) {
                if (prop in t) return t[prop];
                return () => Promise.resolve({ rows: [] });
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BatchComposerForm walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Another Network' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin source' }));
        const second = await screen.findByRole('list', { name: 'Actions in transaction 2' });
        fireEvent.change(within(second).getByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review 2 Transactions' }));

        const sign = await screen.findByRole('button', { name: 'Sign Batch' });
        await waitFor(() => expect(sign).not.toBeDisabled());
        fireEvent.click(sign);

        const approveVisible = async () => {
            let approve;
            await waitFor(() => {
                approve = Array.from(document.querySelectorAll('button'))
                    .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
                expect(approve).toBeTruthy();
            });
            return approve;
        };
        fireEvent.click(await approveVisible());
        await waitFor(() => expect(calls.filter((c) => c.method === 'advancedAction')).toHaveLength(1));
        fireEvent.click(await approveVisible());
        await waitFor(() => expect(calls.filter((c) => c.method === 'advancedAction')).toHaveLength(2));

        const composes = calls.filter((c) => c.method === 'composeForConfirm');
        expect(composes.map((c) => c.args.chainId)).toEqual([CHAIN_A, CHAIN_B]);
        const submits = calls.filter((c) => c.method === 'advancedAction').map((c) => c.args);
        expect(submits.map((s) => [s.chainId, s.from.address, s.params.COMMAND])).toEqual([
            [CHAIN_A, ADDRESS_A.address, 'BROADCAST|0|1|btc'],
            [CHAIN_B, ADDRESS_B.address, 'BROADCAST|0|1|ltc'],
        ]);
        expect(await screen.findByText('2 transactions sent')).toBeTruthy();
        expect(screen.getByText(`tx-${CHAIN_A}`)).toBeTruthy();
        expect(screen.getByText(`tx-${CHAIN_B}`)).toBeTruthy();
    }, 30000);

    it('removes a later card with its last action, and refuses two cards on one network and From', async () => {
        mount();
        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Another Network' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin source' }));
        const second = await screen.findByRole('list', { name: 'Actions in transaction 2' });
        fireEvent.change(within(second).getByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });

        // A third card on Litecoin from the same address would be the same transaction.
        fireEvent.click(screen.getByRole('button', { name: 'Add Another Network' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin source' }));
        const third = await screen.findByRole('list', { name: 'Actions in transaction 3' });
        fireEvent.change(within(third).getByRole('combobox', { name: 'Action' }), { target: { value: 'BROADCAST' } });
        expect(await screen.findByText(/Transaction 3 uses the same network and From address as transaction 2/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review 3 Transactions' })).toBeDisabled();

        fireEvent.click(within(third).getByRole('button', { name: 'Remove' }));
        expect(screen.queryByRole('list', { name: 'Actions in transaction 3' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Review 2 Transactions' })).not.toBeDisabled();
    });
});
