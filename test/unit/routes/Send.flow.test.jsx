// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import {
    Send,
    getUnusualSendWarnings,
} from '../../../packages/core/src/shared/routes/Send.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'send-flow-wallet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SAVED_LOOKALIKE = 'bc1q111111111111111111111111abcdef';
const POISONED_TO = 'bc1qzzzzzzzzzzzzzzzzzzzzzzzzabcdef';
const LTC_TO = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';
const AMOUNT = '0.01234567';
const PASSWORD = 'correct horse battery staple';
const PSBT = '70736274ff';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function composedSend({ amount = AMOUNT, networkFeeSats = 1234 } = {}) {
    return {
        psbt: PSBT,
        encoding: 'P2SH',
        actionString: `SEND|1|BTC|${amount}|${TO}`,
        version: 1,
        chainId: CHAIN_ID,
        networkFeeSats,
        decoded: {
            summary: `Send ${amount} BTC`,
            details: [
                { label: 'Token', value: 'BTC' },
                { label: 'Amount', value: amount },
                { label: 'Destination', value: TO },
            ],
            warnings: [],
        },
        simulation: {
            deltas: [{ tick: 'BTC', before: '1', after: '0.98764199' }],
            notes: [],
        },
    };
}

function mount({
    walletMode = 'full',
    sendResult = { txid: TXID },
    onBack = () => {},
    onDone,
    contacts = [],
    history = [],
    networkFeeSats = 1234,
} = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
                id: 'address-1',
                address: FROM,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN_ID]: { id: 'address-1', address: FROM },
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode,
            activeNetwork: 'mainnet',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 0 },
        }),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue(contacts),
        saveContact: vi.fn().mockImplementation(async ({ input, record }) => record || {
            ...input,
            id: 'saved-contact',
            schemaVersion: 1,
            avatarSeed: input.entries[0].address,
            createdAt: '2026-10-13T00:00:00.000Z',
            updatedAt: '2026-10-13T00:00:00.000Z',
        }),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockImplementation(async (request) => composedSend({
            amount: request.amount,
            networkFeeSats,
        })),
        sendToken: vi.fn().mockImplementation(async () => {
            if (sendResult instanceof Error) throw sendResult;
            return sendResult;
        }),
        buildSendPsbtRequest: vi.fn().mockResolvedValue({
            psbtHex: PSBT,
            encoding: 'P2SH',
            fromAddress: FROM,
            chainId: CHAIN_ID,
        }),
    };
    // Send's supporting lookups are not part of this flow contract. Empty
    // host responses keep the test focused on the compose and submit messages.
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
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <Send walletId={WALLET_ID} onBack={onBack} onDone={onDone} />
            </ToastHost>
        </MessagingProvider>,
    );
    return messaging;
}

async function fillSendForm(sendAmount = AMOUNT) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: sendAmount } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
}

async function openPasswordConfirm(messaging) {
    await fillSendForm();
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    return screen.findByTestId('confirm-modal');
}

async function approveWithPassword(messaging) {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    const approve = screen.getByTestId('confirm-approve');
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Send flow with mocked messaging', () => {
    it('uses strict exact-decimal thresholds for unusual-send warnings', () => {
        const boundary = getUnusualSendWarnings({
            sendTotals: [{ tick: 'BTC', amount: '0.9' }],
            balances: [{ tick: 'BTC', amount: '1' }],
            feeAmount: '0.09',
            nativeTicker: 'BTC',
            isNativeSend: true,
        });
        expect(boundary).toEqual([]);

        expect(getUnusualSendWarnings({
            sendTotals: [{ tick: 'BTC', amount: '0.900000000000000001' }],
            balances: [{ tick: 'BTC', amount: '1' }],
            feeAmount: '0.090000000000000001',
            nativeTicker: 'BTC',
            isNativeSend: true,
        })).toEqual([
            'This sends more than 90% of your BTC balance.',
            'The network fee is more than 10% of the BTC amount you are sending.',
        ]);
    });

    it('shows unusual-send warnings without blocking approval', async () => {
        const messaging = mount({ networkFeeSats: 9_100_001 });
        await fillSendForm('0.91');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        const warnings = await screen.findByTestId('send-unusual-warnings');
        expect(warnings).toHaveTextContent('This sends more than 90% of your BTC balance.');
        expect(warnings).toHaveTextContent(
            'The network fee is more than 10% of the BTC amount you are sending.',
        );

        await approveWithPassword(messaging);
        expect(messaging.sendToken).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.91' }));
    });

    it('tabs through payment fields and reviews only a valid Enter submission', async () => {
        const user = userEvent.setup();
        const messaging = mount();
        await screen.findByLabelText('From');
        const destination = await screen.findByLabelText(/^To$/);
        destination.focus();

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open address book' }));
        await user.tab();
        // The recipient field's paste control sits below it, after its in-field icon.
        expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Paste from clipboard' })[0]);
        await user.tab();
        expect(document.activeElement).toBe(screen.getByLabelText('Token'));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByLabelText(/^Amount \(/));
        await user.keyboard('{Enter}');

        expect(await screen.findByRole('alert')).toHaveTextContent('Destination address is required.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(destination, { target: { value: TO } });
        const amount = screen.getByLabelText(/^Amount \(/);
        fireEvent.change(amount, { target: { value: AMOUNT } });
        amount.focus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();
    });

    it('cleans a pasted recipient, shows both ends, and signs the full cleaned address', async () => {
        const messaging = mount();
        const toField = await screen.findByLabelText(/^To$/);
        fireEvent.paste(toField, {
            clipboardData: { getData: () => ` \u200B${TO}\uFEFF ` },
        });

        expect(toField).toHaveValue(TO);
        expect(screen.getByText('Check pasted recipient')).toBeInTheDocument();
        expect(screen.getByLabelText(TO)).toHaveTextContent('bc1qw5…v8f3t4');

        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledWith(
            expect.objectContaining({ to: TO }),
        ));
        await screen.findByTestId('confirm-modal');
        await approveWithPassword(messaging);
        expect(messaging.sendToken).toHaveBeenCalledWith(expect.objectContaining({ to: TO }));
    });

    it('plainly refuses a pasted address from another chain', async () => {
        const messaging = mount();
        const toField = await screen.findByLabelText(/^To$/);
        fireEvent.paste(toField, {
            clipboardData: { getData: () => LTC_TO },
        });

        expect(toField).toHaveValue(LTC_TO);
        expect(await screen.findByText(
            'This looks like a Litecoin address, not a Bitcoin address.',
        )).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: AMOUNT } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('searches contacts and immediately explains a wrong-chain pick', async () => {
        const doge = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
        const messaging = mount({
            contacts: [{
                id: 'shibe',
                name: 'Shibe',
                entries: [{ chain: 'dogecoin', address: doge, label: 'Tips' }],
            }],
        });

        const to = await screen.findByLabelText(/^To$/);
        fireEvent.change(to, { target: { value: 'shi' } });
        fireEvent.mouseDown(screen.getByRole('option', { name: /Shibe/ }));

        expect(to).toHaveValue(doge);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'This looks like a Dogecoin address, not a Bitcoin address.',
        );
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        expect(screen.getByRole('form', { name: 'Send' })).toHaveTextContent(
            'This looks like a Dogecoin address, not a Bitcoin address.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('shows recent recipients from a wrapped history response', async () => {
        const recent = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
        mount({
            history: { data: [{ action: 'SEND', destination: recent, timestamp: 123 }] },
        });

        const to = await screen.findByLabelText(/^To$/);
        fireEvent.focus(to);
        await waitFor(() => expect(screen.getByText('Previously sent')).toBeInTheDocument());
        fireEvent.change(to, { target: { value: '1BvB' } });
        fireEvent.mouseDown(screen.getByRole('option', { name: /Recent/ }));

        expect(to).toHaveValue(recent);
    });

    it.each([
        {
            source: 'a contact',
            contacts: [{
                id: 'alice',
                name: 'Alice',
                entries: [{ chain: 'bitcoin', address: SAVED_LOOKALIKE }],
            }],
            history: [],
            sourceLabel: 'contact "Alice"',
        },
        {
            source: 'send history',
            contacts: [],
            history: [{ action: 'SEND', destination: SAVED_LOOKALIKE, timestamp: 123 }],
            sourceLabel: 'an address you have sent to before',
        },
    ])('warns before review when a recipient copies both ends of $source', async ({
        contacts,
        history,
        sourceLabel,
    }) => {
        const messaging = mount({ contacts, history });
        const to = await screen.findByLabelText(/^To$/);
        fireEvent.change(to, { target: { value: POISONED_TO } });

        const warning = await screen.findByRole('alert');
        expect(warning).toHaveTextContent(sourceLabel);
        expect(warning).toHaveTextContent(SAVED_LOOKALIKE);
        expect(screen.getByRole('form', { name: 'Send' })).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('reviews every payment field, signs with the password, and shows the txid', async () => {
        const onBack = vi.fn();
        const onDone = vi.fn();
        const messaging = mount({ onBack, onDone });
        const confirm = await openPasswordConfirm(messaging);

        expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            from: expect.objectContaining({ address: FROM, addressId: 'address-1' }),
            to: TO,
            tick: 'BTC',
            amount: AMOUNT,
        }));
        expect(within(confirm).getByTestId('confirm-chain-badge')).toHaveTextContent('Bitcoin');
        expect(within(confirm).getByTestId('confirm-source')).toHaveTextContent(FROM);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`Send ${AMOUNT} BTC`);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`TokenBTC`);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`Amount${AMOUNT}`);
        expect(within(confirm).getByTestId('action-intent')).toHaveTextContent(`To${TO}`);
        expect(within(confirm).getByTestId('confirm-fee')).toHaveTextContent('Network fee: 0.00001234 BTC');
        expect(within(confirm).getByLabelText('Password')).toBeInTheDocument();

        await approveWithPassword(messaging);

        expect(messaging.sendToken).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            to: TO,
            tick: 'BTC',
            amount: AMOUNT,
            password: PASSWORD,
            prebuiltPsbt: expect.objectContaining({ psbtHex: PSBT }),
        }));
        expect(await screen.findByRole('heading', { name: 'Broadcast pending' })).toBeInTheDocument();
        expect(screen.getByText(TXID)).toBeInTheDocument();
        expect(screen.getByText(`${AMOUNT} BTC`)).toBeInTheDocument();
        const announcement = screen.getByRole('status');
        expect(announcement).toHaveAttribute('aria-live', 'polite');
        expect(announcement).toHaveAttribute('aria-atomic', 'true');
        expect(announcement).toHaveTextContent(/broadcast but is not confirmed yet/i);
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Copy transaction id' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /View on explorer/i })).toHaveAttribute(
            'href',
            `https://explorer.xchain.io/BTC/tx/${TXID}`,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('saves a new recipient as a contact after broadcast', async () => {
        const messaging = mount();
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);
        await screen.findByRole('heading', { name: 'Broadcast pending' });

        fireEvent.click(screen.getByRole('button', { name: 'Save recipient' }));
        fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alice' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

        await waitFor(() => expect(messaging.saveContact).toHaveBeenCalledWith({
            input: {
                name: 'Alice',
                notes: '',
                entries: [{ chain: 'bitcoin', address: TO, label: '' }],
            },
        }));
        expect(await screen.findByText('Recipient saved to contacts.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save recipient' })).not.toBeInTheDocument();
    });

    it('ends on the signed-not-broadcast screen when the signed transaction is queued', async () => {
        const transient = Object.assign(new Error('node connection refused'), {
            name: 'BroadcastFailedTransientError',
        });
        const messaging = mount({ sendResult: transient });
        await openPasswordConfirm(messaging);
        await approveWithPassword(messaging);

        expect(await screen.findByRole('heading', { name: 'Signed. Not broadcast yet.' }))
            .toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/queued-transactions banner/i);
        expect(screen.getByRole('status')).toHaveTextContent(/don't send this payment again/i);
        expect(screen.queryByText(TXID)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send another' })).not.toBeInTheDocument();
    });

    it('reviews the payment and builds an unsigned PSBT in watcher mode', async () => {
        const messaging = mount({ walletMode: 'watcher' });
        await fillSendForm();

        const review = await screen.findByRole('form', { name: 'Review send' });
        expect(review).toHaveTextContent(`Send ${AMOUNT} BTC on Bitcoin to ${TO}`);
        expect(review).toHaveTextContent('Chain');
        expect(review).toHaveTextContent('Bitcoin');
        expect(review).toHaveTextContent('From');
        expect(review).toHaveTextContent('bc1qse…ndersa');
        expect(review).toHaveTextContent('Token');
        expect(review).toHaveTextContent('BTC');
        expect(review).toHaveTextContent('Amount');
        expect(review).toHaveTextContent(AMOUNT);
        expect(review).toHaveTextContent('Destination');
        expect(review).toHaveTextContent(TO);
        expect(review).toHaveTextContent('Network fee');
        expect(within(review).queryByLabelText('Password')).not.toBeInTheDocument();

        fireEvent.click(within(review).getByRole('button', { name: 'Create unsigned transaction: send' }));

        await waitFor(() => expect(messaging.buildSendPsbtRequest).toHaveBeenCalledTimes(1));
        expect(messaging.buildSendPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET_ID,
            chainId: CHAIN_ID,
            to: TO,
            tick: 'BTC',
            amount: AMOUNT,
        }));
        expect(messaging.sendToken).not.toHaveBeenCalled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(await screen.findByRole('heading', { name: 'Unsigned transaction, ready for signing' }))
            .toBeInTheDocument();
        expect(screen.getByLabelText('Unsigned transaction hex')).toHaveValue(PSBT);
    });
});
