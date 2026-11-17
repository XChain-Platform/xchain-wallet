// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Batch compose in the operator's layout 1 ("Nested sections", 2026-11-14):
// the Actions section lists the transactions as collapsible rows. Closed, a
// transaction summarises its network, action count, From address and fee;
// open, it shows its own Network and From row, its action rows, Add action
// and Remove transaction.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const CHAIN_A = 'bitcoin-mainnet';
const CHAIN_B = 'litecoin-mainnet';
const ADDRESS_A = {
    id: 'address-btc',
    address: 'bc1qbatchsender000000000000000000000000000',
    source: 'hd',
};
const ADDRESS_A2 = {
    id: 'address-btc-2',
    address: 'bc1qbatchsecond000000000000000000000000000',
    source: 'hd',
};
const ADDRESS_B = {
    id: 'address-ltc',
    address: 'ltc1qbatchsender00000000000000000000000000',
    source: 'hd',
};

// The picker stands in for the own-address screen: one tap switches to the
// planned network and picks the planned address (Litecoin unless a test
// plans another).
let mockPick = { chainId: CHAIN_B, address: ADDRESS_B };
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, onChainChange, onPick }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId}>
            <button
                type="button"
                onClick={() => {
                    onChainChange?.(mockPick.chainId);
                    onPick(mockPick.address);
                }}
            >
                Pick planned source
            </button>
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { selectOption } from '../../helpers/selectOption.js';

beforeEach(() => { mockPick = { chainId: CHAIN_B, address: ADDRESS_B }; });
afterEach(() => cleanup());

function mount(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_A]: [ADDRESS_A, ADDRESS_A2], [CHAIN_B]: [ADDRESS_B] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_A]: { id: ADDRESS_A.id, address: ADDRESS_A.address } }),
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

const txItem = (number) => document.querySelector(`[data-batch-tx="${number}"]`);
// The transaction's own header row: it folds the transaction open and closed.
const txHeader = (number) => txItem(number).firstElementChild;
const fromRow = (number) => screen.getByRole('button', { name: `Change the network and From address of transaction ${number}` });
const actionsOf = (number) => screen.getByRole('list', { name: `Actions in transaction ${number}` });

/** Adds a transaction through the picker, then picks BROADCAST for its first action. */
async function addTransaction(number, pick = null) {
    if (pick) mockPick = pick;
    fireEvent.click(screen.getByRole('button', { name: /^Add transaction/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick planned source' }));
    const list = await screen.findByRole('list', { name: `Actions in transaction ${number}` });
    selectOption(within(list).getByRole('combobox', { name: 'Action' }), 'BROADCAST');
    return list;
}

describe('BatchComposerForm transactions (layout 1)', () => {
    it('opens on one transaction with its From row, and reads each action as a sentence', async () => {
        mount();
        await screen.findByRole('list', { name: 'Transactions' });
        // No page-level From section; the transaction's own row names its
        // From through AddressText fit mode (G99).
        expect(screen.queryByLabelText('From address')).toBeNull();
        expect(within(fromRow(1)).getByLabelText(ADDRESS_A.address)).toBeTruthy();
        expect(fromRow(1)).toHaveTextContent('From, on Bitcoin');
        expect(txHeader(1)).toHaveAttribute('aria-expanded', 'true');
        expect(txHeader(1)).toHaveTextContent('Transaction 1');
        expect(txHeader(1)).toHaveTextContent('1 action');

        const row = screen.getByRole('region', { name: 'Action 1' });
        expect(within(row).getByText('Choose an action')).toBeTruthy();
        selectOption(within(row).getByRole('combobox', { name: 'Action' }), 'SEND');
        fireEvent.change(within(row).getByRole('textbox', { name: 'Params (JSON object)' }), {
            target: { value: '{"VERSION":"0","TICK":"PEPE","AMOUNT":"250","DESTINATION":"bc1qdestination0000000000009cb2"}' },
        });
        expect(within(row).getByText('Send 250 PEPE')).toBeTruthy();
        // G99: the destination is the fitting AddressText after "to".
        const destination = within(row).getByLabelText('bc1qdestination0000000000009cb2');
        expect(destination.parentElement.textContent.startsWith('to ')).toBe(true);

        // Tapping the sentence folds its editor; tapping again opens it.
        const sentence = within(row).getByRole('button', { name: /Send 250 PEPE/ });
        expect(sentence).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(sentence);
        expect(within(row).queryByRole('combobox', { name: 'Action' })).toBeNull();
        fireEvent.click(sentence);
        expect(within(row).getByRole('combobox', { name: 'Action' })).toHaveValue('SEND');

        // One transaction with one action has nothing to remove.
        expect(screen.queryByRole('button', { name: /^Remove (action|transaction)/ })).toBeNull();
        // Add and remove controls are plain rows, never red buttons.
        expect(screen.getByRole('button', { name: /^Add action/ }).className).not.toMatch(/danger/);
        expect(screen.getByRole('button', { name: /^Add transaction/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add Another Network' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Review 1 Transaction' })).toBeTruthy();
    });

    it('shows three transactions closed with their summaries, and opens one in place', async () => {
        mount();
        const first = await screen.findByRole('region', { name: 'Action 1' });
        selectOption(within(first).getByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: /^Add action/ }));
        selectOption(within(screen.getByRole('region', { name: 'Action 2' })).getByRole('combobox', { name: 'Action' }), 'SEND');
        await addTransaction(2, { chainId: CHAIN_A, address: ADDRESS_A2 });
        await addTransaction(3, { chainId: CHAIN_B, address: ADDRESS_B });
        // A new transaction opens expanded with one action.
        expect(txHeader(3)).toHaveAttribute('aria-expanded', 'true');
        expect(within(actionsOf(3)).getAllByRole('region')).toHaveLength(1);

        for (const n of [1, 2, 3]) fireEvent.click(txHeader(n));

        expect(screen.queryAllByRole('combobox', { name: 'Action' })).toHaveLength(0);
        expect(screen.queryByRole('list', { name: /^Actions in transaction/ })).toBeNull();
        const expected = [
            [1, 'Bitcoin', '2 actions', ADDRESS_A.address],
            [2, 'Bitcoin', '1 action', ADDRESS_A2.address],
            [3, 'Litecoin', '1 action', ADDRESS_B.address],
        ];
        for (const [n, network, count, address] of expected) {
            const header = txHeader(n);
            expect(header).toHaveAttribute('aria-expanded', 'false');
            expect(header).toHaveTextContent(`Transaction ${n}`);
            expect(header).toHaveTextContent(network);
            expect(header).toHaveTextContent(count);
            // Closed, the summary carries the From address (G99) and the fee.
            expect(within(header).getByLabelText(address)).toBeTruthy();
            expect(header.querySelector('[data-batch-tx-fee]')).toHaveTextContent(/^~.+fee$/);
        }
        // Each picked action shows its icon in the summary line.
        expect(txHeader(1).querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
        expect(screen.getByRole('button', { name: 'Review 3 Transactions' })).not.toBeDisabled();

        fireEvent.click(txHeader(2));
        expect(txHeader(2)).toHaveAttribute('aria-expanded', 'true');
        expect(within(fromRow(2)).getByLabelText(ADDRESS_A2.address)).toBeTruthy();
        expect(within(actionsOf(2)).getByRole('combobox', { name: 'Action' })).toHaveValue('BROADCAST');
        expect(screen.queryByRole('list', { name: 'Actions in transaction 1' })).toBeNull();
        expect(screen.queryByRole('list', { name: 'Actions in transaction 3' })).toBeNull();
    });

    it('adds a transaction on another network and reviews both on their own chains', async () => {
        const messaging = mount();
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');

        fireEvent.click(screen.getByRole('button', { name: /^Add transaction/ }));
        // The picker proposes the first network no transaction uses yet.
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN_B);
        fireEvent.click(screen.getByRole('button', { name: 'Pick planned source' }));

        const second = await screen.findByRole('list', { name: 'Actions in transaction 2' });
        selectOption(within(second).getByRole('combobox', { name: 'Action' }), 'BROADCAST');
        expect(txHeader(2)).toHaveTextContent('Transaction 2');

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

    it('allows two transactions on one network from different From addresses', async () => {
        const messaging = mount();
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        await addTransaction(2, { chainId: CHAIN_A, address: ADDRESS_A2 });

        expect(fromRow(2)).toHaveTextContent('From, on Bitcoin');
        expect(screen.queryByText(/uses the same network and From address/)).toBeNull();
        const review = screen.getByRole('button', { name: 'Review 2 Transactions' });
        expect(review).not.toBeDisabled();
        fireEvent.click(review);

        const secondReview = await screen.findByRole('region', { name: 'Transaction 2' });
        expect(within(secondReview).getByLabelText(ADDRESS_A2.address)).toBeTruthy();
        expect(messaging.validateAction).toHaveBeenCalledTimes(2);
        expect(messaging.validateAction.mock.calls.map(([args]) => args.chainId)).toEqual([CHAIN_A, CHAIN_A]);
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
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        await addTransaction(2);
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

    it('removes a later transaction with its last action, and refuses two transactions on one network and From', async () => {
        mount();
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        await addTransaction(2);

        // A third transaction on Litecoin from the same address would be the same transaction.
        const third = await addTransaction(3);
        expect(await screen.findByText(/Transaction 3 uses the same network and From address as transaction 2/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review 3 Transactions' })).not.toBeDisabled();

        fireEvent.click(within(third).getByRole('button', { name: /^Remove action/ }));
        expect(screen.queryByRole('list', { name: 'Actions in transaction 3' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Review 2 Transactions' })).not.toBeDisabled();
    });

    it('adds and removes actions inside one transaction', async () => {
        mount();
        await screen.findByRole('region', { name: 'Action 1' });
        await addTransaction(2);
        const second = actionsOf(2);
        // Transaction 2 holds one action, but with two transactions its action
        // and the transaction can both go.
        expect(within(second).getByRole('button', { name: /^Remove action/ })).toBeTruthy();

        const addInSecond = within(txItem(2)).getByRole('button', { name: /^Add action/ });
        fireEvent.click(addInSecond);
        expect(within(actionsOf(2)).getAllByRole('region', { name: /^Action \d$/ })).toHaveLength(2);
        expect(within(actionsOf(1)).getAllByRole('region', { name: /^Action \d$/ })).toHaveLength(1);
        expect(txHeader(2)).toHaveTextContent('2 actions');
        expect(within(txItem(2)).getByRole('button', { name: /^Remove transaction/ }))
            .toHaveTextContent('Drop Transaction 2 and its 2 actions');

        fireEvent.click(within(within(actionsOf(2)).getByRole('region', { name: 'Action 2' })).getByRole('button', { name: /^Remove action/ }));
        expect(within(actionsOf(2)).getAllByRole('region', { name: /^Action \d$/ })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Review 2 Transactions' })).toBeTruthy();
    });

    it('removes transaction 1 and hands its place to the next transaction', async () => {
        const messaging = mount();
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        await addTransaction(2);

        fireEvent.click(within(txItem(1)).getByRole('button', { name: /^Remove transaction/ }));

        expect(txItem(2)).toBeNull();
        expect(txHeader(1)).toHaveTextContent('Litecoin');
        expect(within(fromRow(1)).getByLabelText(ADDRESS_B.address)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));
        await waitFor(() => expect(messaging.buildBatchCommand).toHaveBeenCalledWith({
            chainId: CHAIN_B,
            subActions: [{ action: 'BROADCAST', params: { VERSION: '0' } }],
        }));
        expect(messaging.validateAction.mock.calls.map(([args]) => args.chainId)).toEqual([CHAIN_B]);
        expect(messaging.buildBatchCommand.mock.calls.every(([args]) => args.chainId === CHAIN_B)).toBe(true);
    });

    it('removing the only transaction leaves a blank one on the same network and From', async () => {
        mount();
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(screen.getByRole('button', { name: /^Add action/ }));

        fireEvent.click(screen.getByRole('button', { name: /^Remove transaction/ }));

        expect(screen.getAllByRole('region', { name: /^Action \d$/ })).toHaveLength(1);
        expect(screen.getByRole('combobox', { name: 'Action' })).toHaveValue('');
        expect(within(fromRow(1)).getByLabelText(ADDRESS_A.address)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Remove (action|transaction)/ })).toBeNull();
    });

    it('opens a folded transaction and action that hold an error when Review is pressed', async () => {
        mount();
        const row = await screen.findByRole('region', { name: 'Action 1' });
        fireEvent.click(within(row).getByRole('button', { name: /Choose an action/ }));
        expect(within(row).queryByRole('combobox', { name: 'Action' })).toBeNull();
        fireEvent.click(txHeader(1));
        expect(screen.queryByRole('region', { name: 'Action 1' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(txHeader(1)).toHaveAttribute('aria-expanded', 'true');
        const reopened = screen.getByRole('region', { name: 'Action 1' });
        expect(within(reopened).getByText('Step 1: pick an action.')).toBeTruthy();
        expect(within(reopened).getByRole('combobox', { name: 'Action' })).toBeTruthy();

        // Review stays off until the error is fixed, so folding the
        // transaction again must not hide why.
        expect(screen.getByRole('button', { name: 'Review 1 Transaction' })).not.toBeDisabled();
        fireEvent.click(txHeader(1));
        expect(txHeader(1)).toHaveAttribute('aria-expanded', 'true');
        expect(within(reopened).getByText('Step 1: pick an action.')).toBeTruthy();
        // A folded action still shows its error under its sentence.
        fireEvent.click(within(screen.getByRole('region', { name: 'Action 1' })).getByRole('button', { name: /Choose an action/ }));
        expect(screen.queryByRole('combobox', { name: 'Action' })).toBeNull();
        expect(within(screen.getByRole('region', { name: 'Action 1' })).getByText('Step 1: pick an action.')).toBeTruthy();
    });

    it('keeps Advanced and Speed and Fees under Actions, on transaction 1', async () => {
        mount();
        await screen.findByRole('region', { name: 'Action 1' });
        const ids = [...document.querySelectorAll('[data-form-section]')].map((node) => node.getAttribute('data-form-section'));
        // No page From section; Advanced (drawn from transaction 1's network
        // and From, handed over by the frame's from slot) sits above Speed and Fees.
        expect(ids).not.toContain('from');
        expect(ids.indexOf('actions')).toBe(0);
        expect(ids.slice(-2)).toEqual(['advanced', 'fee']);
    });

    it('reads settings a fixed number of times however many transactions there are', async () => {
        // Each picker trip remounts the form's sections the same way, so the
        // one-transaction run makes the same two trips (re-picking its own
        // From) as the three-transaction run makes to add two transactions.
        const one = mount();
        await screen.findByRole('region', { name: 'Action 1' });
        for (let trip = 0; trip < 2; trip += 1) {
            mockPick = { chainId: CHAIN_A, address: ADDRESS_A };
            fireEvent.click(fromRow(1));
            fireEvent.click(screen.getByRole('button', { name: 'Pick planned source' }));
            await screen.findByRole('region', { name: 'Action 1' });
        }
        await waitFor(() => expect(one.getSettings.mock.calls.length).toBeGreaterThan(0));
        const withOne = one.getSettings.mock.calls.length;
        cleanup();

        const three = mount();
        await screen.findByRole('region', { name: 'Action 1' });
        await addTransaction(2, { chainId: CHAIN_A, address: ADDRESS_A2 });
        await addTransaction(3, { chainId: CHAIN_B, address: ADDRESS_B });
        expect(document.querySelectorAll('[data-batch-tx]')).toHaveLength(3);
        await waitFor(() => expect(three.getSettings.mock.calls.length).toBeGreaterThan(0));
        expect(three.getSettings.mock.calls.length).toBe(withOne);
    });

    it('opens a folded transaction when the action checks refuse one of its actions', async () => {
        mount({
            validateAction: vi.fn().mockResolvedValue({ valid: false, errors: [{ message: 'Destination is required.' }] }),
        });
        selectOption(await screen.findByRole('combobox', { name: 'Action' }), 'BROADCAST');
        fireEvent.click(txHeader(1));
        expect(screen.queryByRole('region', { name: 'Action 1' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Review 1 Transaction' }));

        expect(within(await screen.findByLabelText('Form errors')).getByText('Step 1: Destination is required.')).toBeTruthy();
        expect(txHeader(1)).toHaveAttribute('aria-expanded', 'true');
        expect(within(screen.getByRole('region', { name: 'Action 1' })).getByRole('combobox', { name: 'Action' }))
            .toHaveValue('BROADCAST');
    });
});
