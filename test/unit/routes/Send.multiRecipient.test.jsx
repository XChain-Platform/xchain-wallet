// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-52 through the real Send form's Multi tab: adding a recipient must change
// the PAYLOAD, not just the screen.
//
// These drive the component the way a user does (open Multi, press Add
// Recipient, fill To, Asset and Amount, press Add, submit) and assert what
// crosses the messaging boundary, because that is the only place the
// multi-leg send becomes real. The refusals are here for the same reason: a
// form that renders a warning but still submits would compose a transaction
// the chain rejects, or worse, one it accepts wrongly.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            {['PEPE', 'DANK', 'BTC', 'GATED'].map((tick) => (
                <button key={tick} type="button" onClick={() => onSelect({ chainId: CHAIN, tick })}>
                    {`Pick ${tick}`}
                </button>
            ))}
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
// Valid mainnet bech32 destinations: the form decodes these for real, so a
// made-up string would fail address validation before the payload is built.
const ALICE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BOB = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const CAROL = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: FROM,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

const BALANCES = {
    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
    tokens: [
        { tick: 'PEPE', quantity: '1000', divisibility: 0 },
        { tick: 'DANK', quantity: '1000', divisibility: 0 },
        { tick: 'GATED', quantity: '1000', divisibility: 0 },
    ],
};

const HW_ADDRESSES = {
    [CHAIN]: [{ ...ADDRESSES[CHAIN][0], source: 'trezor', signerId: 'trezor-1', signerLabel: 'Trezor' }],
};

function mount({ gated = false, watcher = false, balances = null, hardware = false, contacts = [] } = {}) {
    // A wallet's mode is published by the shell from the wallet list, not read
    // from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode: watcher ? 'watcher' : 'full' }], activeWalletId: 'w' });
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(hardware ? HW_ADDRESSES : ADDRESSES),
        ...(hardware ? { getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: HW_ADDRESSES[CHAIN][0] }) } : {}),
        getAddressBalances: balances || vi.fn().mockResolvedValue(BALANCES),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: watcher ? 'watcher' : 'full' }),
        listContacts: vi.fn().mockResolvedValue(contacts),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue(
            gated ? { state: 'ready', groups: [{ keyHash: 'aa', haveKey: true }] } : { state: 'ungated' },
        ),
        buildSendPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: '70736274ff' }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    // Send reaches for a wide messaging surface (history, fee tiers, prices,
    // reservations). Anything this test does not care about answers empty
    // rather than throwing, so an unrelated new call cannot fail these cases.
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

const send = () => fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

async function openMulti() {
    fireEvent.click(await screen.findByRole('tab', { name: 'Multi' }));
    await screen.findByRole('button', { name: /Add Recipient/ });
}

/** Fill the open add-recipient form; any field left undefined stays as it is. */
async function fillEditor({ to, tick, amount } = {}) {
    if (to !== undefined) fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: to } });
    if (tick !== undefined) {
        // Multi offers tokens only, so its field is Token (G60).
        fireEvent.click(screen.getByRole('button', { name: /^Token/ }));
        fireEvent.click(await screen.findByRole('button', { name: `Pick ${tick}` }));
    }
    if (amount !== undefined) {
        fireEvent.change(await screen.findByLabelText(/^Amount/, { selector: 'input' }), { target: { value: amount } });
    }
}

/** Press Add Recipient, fill the row and press Add. */
async function addRow(row) {
    fireEvent.click(await screen.findByRole('button', { name: /Add Recipient/ }));
    await fillEditor(row);
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
}

afterEach(() => {
    cleanup();
    resetWalletModes();
});

describe('Send: Multi tab (PC-52)', () => {
    it('offers Single, Multi and Advanced tabs in the Payment section, Single first and chosen', async () => {
        mount();
        const tabs = await screen.findAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Single', 'Multi', 'Advanced']);
        expect(screen.getByRole('tab', { name: 'Single' })).toHaveAttribute('aria-selected', 'true');
        // Single is the one-recipient send: no extra-recipient rows or switch.
        expect(screen.queryByRole('button', { name: /Add Recipient/ })).toBeNull();
        expect(screen.queryByRole('switch', { name: /Different token per recipient/ })).toBeNull();
    });

    it('opens the contact picker from a Multi row and fills that row while paste stays available', async () => {
        mount({
            contacts: [{
                id: 'contact-carol',
                name: 'Carol',
                entries: [{ address: CAROL, chain: 'bitcoin' }],
            }],
        });
        await openMulti();
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));

        const editor = screen.getByRole('group', { name: 'New recipient' });
        const to = within(editor).getByLabelText(/^To$/);
        fireEvent.paste(to, { clipboardData: { getData: () => `  ${BOB}  ` } });
        expect(to).toHaveValue(BOB);

        const contactsButton = within(editor).getByRole('button', { name: 'Open address book' });
        expect(contactsButton.querySelector('svg')).not.toBeNull();
        fireEvent.click(contactsButton);
        const contactName = await screen.findByText('Carol');
        fireEvent.click(contactName.closest('button'));

        expect(await screen.findByLabelText(/^To$/)).toHaveValue(CAROL);
    });

    it('sends one leg per recipient, with each amount and address intact', async () => {
        const messaging = mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '3' });
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '7' },
            { to: BOB, tick: 'PEPE', amount: '3' },
        ]);
    });

    it('collapses each added recipient into one summary row with its grouped amount', async () => {
        mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '100000' });
        const rows = screen.getAllByTestId('send-multi-row');
        expect(rows).toHaveLength(1);
        expect(within(rows[0]).getByText('100,000 PEPE')).toBeInTheDocument();
        const row = within(rows[0]).getByRole('button', { name: `Edit recipient 1: 100,000 PEPE to ${ALICE}` });
        expect(row).toBeInTheDocument();
        expect(row.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(within(rows[0]).getAllByRole('button')).toHaveLength(1);
        // The editor closed; the next recipient starts from Add Recipient.
        expect(screen.queryByTestId('send-multi-editor')).toBeNull();
    });

    it('carries a different asset per recipient (the multi-tick case)', async () => {
        const messaging = mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'DANK', amount: '3' });
        expect(screen.getByTestId('send-multi-totals'))
            .toHaveTextContent('Total: 7 PEPE + 3 DANK to 2 recipients, in one transaction with one network fee.');
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '7' },
            { to: BOB, tick: 'DANK', amount: '3' },
        ]);
    });

    it('a new row starts on the token the last row used', async () => {
        mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'DANK', amount: '7' });
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        expect(screen.getByRole('button', { name: /^Token/ })).toHaveTextContent('DANK');
    });

    it('puts secondary Cancel left and the green Add action right', async () => {
        mount();
        await openMulti();
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));

        const actions = screen.getByTestId('send-multi-add-actions');
        const [cancel, add] = within(actions).getAllByRole('button');
        expect([cancel.textContent, add.textContent]).toEqual(['Cancel', 'Add']);
        expect(cancel.className).toMatch(/secondary/);
        expect(add.className).toMatch(/success/);
        expect(add.querySelector('svg')).not.toBeNull();
    });

    it('keeps the row header while expanded and Update saves then collapses it', async () => {
        const messaging = mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '3' });
        const header = screen.getByRole('button', { name: `Edit recipient 1: 7 PEPE to ${ALICE}` });
        fireEvent.click(header);
        expect(header).toBeInTheDocument();
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById(header.getAttribute('aria-controls'))).not.toBeNull();
        expect(screen.getByRole('button', { name: /Add Recipient/ })).toBeInTheDocument();
        expect(screen.getByLabelText(/^To$/)).toHaveValue(ALICE);
        await fillEditor({ to: CAROL, amount: '9' });
        const actions = screen.getByTestId('send-multi-edit-actions');
        const [remove, update] = within(actions).getAllByRole('button');
        expect([remove.textContent, update.textContent]).toEqual(['Remove', 'Update']);
        expect(remove.className).toMatch(/danger/);
        expect(remove.querySelector('svg')).not.toBeNull();
        expect(update.className).toMatch(/success/);
        expect(update.querySelector('svg')).not.toBeNull();
        fireEvent.click(update);
        expect(screen.queryByRole('group', { name: 'Edit recipient 1' })).toBeNull();
        expect(screen.getByRole('button', { name: `Edit recipient 1: 9 PEPE to ${CAROL}` }))
            .toHaveAttribute('aria-expanded', 'false');
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        expect(messaging.composeForConfirm.mock.calls[0][0].legs).toEqual([
            { to: CAROL, tick: 'PEPE', amount: '9' },
            { to: BOB, tick: 'PEPE', amount: '3' },
        ]);
    });

    it('a second header tap collapses and discards edits; another header allows only one expanded row', async () => {
        mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'DANK', amount: '3' });
        const first = screen.getByRole('button', { name: `Edit recipient 1: 7 PEPE to ${ALICE}` });
        const second = screen.getByRole('button', { name: `Edit recipient 2: 3 DANK to ${BOB}` });

        fireEvent.click(first);
        fireEvent.change(screen.getByLabelText(/^To$/), { target: { value: CAROL } });
        fireEvent.click(first);
        expect(first).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('group', { name: 'Edit recipient 1' })).toBeNull();

        fireEvent.click(first);
        expect(screen.getByLabelText(/^To$/)).toHaveValue(ALICE);
        fireEvent.click(second);
        expect(first).toHaveAttribute('aria-expanded', 'false');
        expect(second).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByRole('group', { name: 'Edit recipient 1' })).toBeNull();
        expect(screen.getByRole('group', { name: 'Edit recipient 2' })).toBeInTheDocument();
    });

    it('keeps an open Add Recipient form available while a row expands', async () => {
        mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        const addEditor = screen.getByRole('group', { name: 'New recipient' });
        fireEvent.click(screen.getByRole('button', { name: `Edit recipient 1: 7 PEPE to ${ALICE}` }));

        expect(addEditor).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Edit recipient 1' })).toBeInTheDocument();
        expect(screen.getByTestId('send-multi-add-actions')).toBeInTheDocument();
        expect(within(screen.getByTestId('send-multi-edit-actions')).getAllByRole('button'))
            .toHaveLength(2);
        send();
        const notice = screen.getByRole('alert', { name: 'Form errors' });
        expect(notice).toHaveTextContent('Add or cancel the recipient you started.');
        expect(notice).toHaveTextContent('Update or collapse the recipient you are editing.');
    });

    it('keeps remove inside the row editor; one left composes a plain single send', async () => {
        const messaging = mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '3' });
        const second = screen.getByRole('button', { name: `Edit recipient 2: 3 PEPE to ${BOB}` });
        expect(screen.queryByRole('button', { name: 'Remove Recipient 2' })).toBeNull();
        fireEvent.click(second);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Recipient 2' }));
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(1);
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const payload = messaging.composeForConfirm.mock.calls[0][0];
        expect(payload.legs).toBeUndefined();
        expect(payload).toMatchObject({ to: ALICE, tick: 'PEPE', amount: '7' });
    });

    it('[REGRESSION] a Single send still carries NO legs at all', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: ALICE } });
        fireEvent.click(screen.getByRole('button', { name: /^Asset/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick PEPE' }));
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '7' } });
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const payload = messaging.composeForConfirm.mock.calls[0][0];
        expect(payload.legs).toBeUndefined();
        expect(payload).toMatchObject({ to: ALICE, tick: 'PEPE', amount: '7' });
    });

    it('checks a row when Add is pressed and adds nothing until it passes', async () => {
        mount();
        await openMulti();
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        expect(screen.getByText('Enter the recipient address.')).toBeInTheDocument();
        expect(screen.getByText('Choose a token.')).toBeInTheDocument();
        expect(screen.getByText('Enter an amount.')).toBeInTheDocument();
        await fillEditor({ to: 'bc1qnotarealaddressatall', tick: 'PEPE', amount: '3' });
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        expect(screen.queryAllByTestId('send-multi-row')).toHaveLength(0);
        expect(screen.getByLabelText(/^To$/)).toHaveAttribute('aria-invalid', 'true');
        // Fixing the field clears its message and lets the row in.
        await fillEditor({ to: BOB });
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(1);
    });

    it('checks every row again at Send, so a row added before the balances loaded cannot skip a rule', async () => {
        // The balances answer only after the row is in, so Add could not yet
        // know PEPE has no decimal places.
        let answer;
        const balances = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
        const messaging = mount({ balances });
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '1.5' });
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(1);
        await waitFor(() => expect(answer).toBeTypeOf('function'));
        answer(BALANCES);
        // The balances have reached the form once a new row's Max can fill
        // a PEPE amount; that row is then cancelled.
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        await fillEditor({ tick: 'PEPE' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Use max available amount' })).not.toBeDisabled());
        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        send();
        expect((await screen.findAllByText(
            'Recipient 1: PEPE has no decimal places, so the amount must be a whole number.',
        )).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses the coin as a Multi asset, since it pays its own output', async () => {
        mount();
        await openMulti();
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        await fillEditor({ to: ALICE, tick: 'BTC', amount: '0.5' });
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        expect(screen.getByText(/BTC is paid in its own output/)).toBeInTheDocument();
        expect(screen.queryAllByTestId('send-multi-row')).toHaveLength(0);
    });

    it('refuses a total one unit over the balance even when every leg is under it', async () => {
        const messaging = mount();
        await openMulti();
        // PEPE holds 1000 whole units: 500 + 501 is one unit too many.
        await addRow({ to: ALICE, tick: 'PEPE', amount: '500' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '501' });
        send();
        expect((await screen.findAllByText('The total PEPE across all recipients exceeds the available balance.')).length)
            .toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('still composes a total that equals the balance exactly', async () => {
        const messaging = mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '500' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '500' });
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });

    it('says what is missing when Send is pressed with no recipient or an unsaved one', async () => {
        const messaging = mount();
        await openMulti();
        send();
        expect((await screen.findAllByText('Add at least one recipient.')).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        await fillEditor({ to: ALICE, tick: 'PEPE', amount: '1' });
        send();
        expect((await screen.findAllByText('Add or cancel the recipient you started.')).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('stops offering Add Recipient at the one-transaction limit and says why', async () => {
        mount();
        await openMulti();
        for (let i = 0; i < 10; i += 1) {
            await addRow({ to: i % 2 ? ALICE : BOB, tick: 'PEPE', amount: String(i + 1) });
        }
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(10);
        expect(screen.queryByRole('button', { name: /Add Recipient/ })).toBeNull();
        expect(screen.getByTestId('send-multi-limit'))
            .toHaveTextContent('One transaction carries at most 10 recipients. Send to anyone else in another payment.');
    });

    it('groups the per-asset totals on the watcher review, with one network fee', async () => {
        mount({ watcher: true });
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'DANK', amount: '3' });
        send();
        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Send 2 assets to 2 recipients');
        const card = screen.getByTestId('confirm-facts');
        const rows = within(card).getAllByTestId('confirm-asset-summary');
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.previousElementSibling.querySelector('[data-testid="confirm-asset-label"]').textContent))
            .toEqual(['PEPE', 'DANK']);
        expect(rows.map((row) => row.textContent)).toEqual(['7 to 1 recipient', '3 to 1 recipient']);
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.000015 BTC');
        expect(screen.getAllByTestId('confirm-fee-network')).toHaveLength(1);
        expect(document.querySelector('details')).toBeNull();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    });

    it('the software confirm screen names the count and groups per-asset totals', async () => {
        mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'DANK', amount: '3' });
        await addRow({ to: CAROL, tick: 'PEPE', amount: '5' });
        send();
        await screen.findByTestId('confirm-modal');
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('3 recipients');
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('2 assets');
        const card = screen.getByTestId('confirm-facts');
        const rows = within(card).getAllByTestId('confirm-asset-summary');
        expect(rows.map((row) => row.previousElementSibling.querySelector('[data-testid="confirm-asset-label"]').textContent))
            .toEqual(['PEPE', 'DANK']);
        expect(rows.map((row) => row.textContent)).toEqual(['12 to 2 recipients', '3 to 1 recipient']);
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-fee-network').closest('[data-testid="confirm-facts"]')).not.toBeNull();
    });

    it('puts one grouped asset total and its fee in the standard watcher review', async () => {
        mount({ watcher: true });
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '3' });
        send();
        const card = await screen.findByTestId('confirm-facts');
        expect(within(card).getAllByTestId('confirm-asset-summary')).toHaveLength(1);
        expect(within(card).getByTestId('confirm-asset-summary')).toHaveTextContent('10 to 2 recipients');
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Send 10 PEPE to 2 recipients');
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.000015 BTC');
        expect(screen.getAllByTestId('confirm-fee-network')).toHaveLength(1);
    });

    it('groups every Advanced text recipient by asset on the standard watcher review', async () => {
        mount({ watcher: true });
        fireEvent.click(await screen.findByRole('tab', { name: 'Advanced' }));
        fireEvent.change(screen.getByLabelText('Recipients'), {
            target: { value: `${ALICE},PEPE,7\n${BOB},DANK,3` },
        });
        send();

        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Send 2 assets to 2 recipients');
        const rows = within(screen.getByTestId('confirm-facts')).getAllByTestId('confirm-asset-summary');
        expect(rows.map((row) => row.previousElementSibling.querySelector('[data-testid="confirm-asset-label"]').textContent))
            .toEqual(['PEPE', 'DANK']);
        expect(rows.map((row) => row.textContent)).toEqual(['7 to 1 recipient', '3 to 1 recipient']);
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.000015 BTC');
    });

    it('a hardware-wallet source composes the same legs on the same confirm path as a single send', async () => {
        const messaging = mount({ hardware: true });
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'DANK', amount: '3' });
        send();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const payload = messaging.composeForConfirm.mock.calls[0][0];
        expect(payload.from).toMatchObject({ source: 'trezor', signerId: 'trezor-1' });
        expect(payload.legs).toEqual([
            { to: ALICE, tick: 'PEPE', amount: '7' },
            { to: BOB, tick: 'DANK', amount: '3' },
        ]);
    });

    it('refuses a multi-recipient send of a gated token (each recipient needs a key handoff)', async () => {
        const messaging = mount({ gated: true });
        await openMulti();
        await addRow({ to: ALICE, tick: 'GATED', amount: '7' });
        await addRow({ to: BOB, tick: 'GATED', amount: '3' });
        expect(await screen.findByText(/Each recipient needs a separate unlock key/)).toBeInTheDocument();
        send();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('Single keeps the first recipient when the tab goes back', async () => {
        mount();
        await openMulti();
        await addRow({ to: ALICE, tick: 'PEPE', amount: '7' });
        await addRow({ to: BOB, tick: 'PEPE', amount: '3' });
        fireEvent.click(screen.getByRole('tab', { name: 'Single' }));
        expect(await screen.findByLabelText(/^To$/)).toHaveValue(ALICE);
        expect(screen.getByLabelText(/^Amount \(/)).toHaveValue('7');
        // And Multi still holds both rows.
        await openMulti();
        expect(screen.getAllByTestId('send-multi-row')).toHaveLength(2);
    });
});
