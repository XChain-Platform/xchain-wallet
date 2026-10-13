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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const MAX_TEXT_LENGTH = 250;
const MAX_MESSAGE_LENGTH = 1_048_576;
const AT_LIMIT = 'm'.repeat(MAX_TEXT_LENGTH);
const OVER_LIMIT = 'm'.repeat(MAX_TEXT_LENGTH + 1);
const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const SOURCE = Object.freeze({
    id: 'btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DOGE_SOURCE = Object.freeze({
    ...SOURCE,
    id: 'doge-0',
    address: 'D8exampleexampleexampleexampleexample',
    derivationPath: "m/44'/3'/0'/0/0",
});

function messagingFor() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [SOURCE], [DOGE]: [DOGE_SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [BTC]: { id: SOURCE.id },
            [DOGE]: { id: DOGE_SOURCE.id },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getRecipientPubkey: vi.fn().mockResolvedValue('02' + 'ab'.repeat(32)),
        getTokenInfo: vi.fn().mockResolvedValue({
            tick: 'CALLABLE',
            creator: SOURCE.address,
            callbackTick: 'XCHAIN',
            callbackAmount: '1',
            callbackBlock: null,
        }),
        tokenHolderSummary: vi.fn().mockResolvedValue({ recipientCount: 1, totalPayout: '1' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', tick: 'JDOG', amount: '1' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
}

function mount(Component, props = {}) {
    const messaging = messagingFor();
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, { walletId: 'w', onBack() {}, ...props }),
    ));
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    __clearTokenInfoCache();
});

describe('BroadcastForm text limits', () => {
    it('shows a live counter and disables Broadcast past the message limit', async () => {
        const messaging = mount(BroadcastForm, { initialChainId: BTC });
        const message = await screen.findByLabelText('Message');
        const submit = screen.getByRole('button', { name: 'Broadcast' });

        fireEvent.change(message, { target: { value: AT_LIMIT } });
        expect(screen.getByText(`${MAX_TEXT_LENGTH} / ${MAX_TEXT_LENGTH} characters.`)).toBeTruthy();
        await waitFor(() => expect(submit.disabled).toBe(false));

        fireEvent.change(message, { target: { value: OVER_LIMIT } });
        expect(screen.getByText(`Message is ${MAX_TEXT_LENGTH + 1} characters; the network accepts at most ${MAX_TEXT_LENGTH}.`)).toBeTruthy();
        expect(submit.disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('ComposeMessage text limit', () => {
    it('shows a live counter and blocks review past the protocol limit', async () => {
        const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const messaging = mount(ComposeMessage, {
            chainId: BTC,
            fixedEncryption: 'plaintext',
            toAddress: recipient,
        });
        const message = await screen.findByLabelText('Message');
        const submit = screen.getByRole('button', { name: 'Send message' });

        fireEvent.change(message, { target: { value: 'hello' } });
        expect(screen.getByText('5 / 1,048,576 characters.')).toBeTruthy();
        expect(submit.disabled).toBe(false);

        fireEvent.change(message, { target: { value: 'm'.repeat(MAX_MESSAGE_LENGTH + 1) } });
        expect(screen.getByText(
            'Message is 1,048,577 characters; the network accepts at most 1,048,576.',
        )).toBeTruthy();
        expect(submit.disabled).toBe(true);
        expect(messaging.composeMessageForConfirm).not.toHaveBeenCalled();
    });

    it('does not look up a key or offer a session request for an invalid recipient', async () => {
        const messaging = mount(ComposeMessage, { chainId: BTC });
        const address = await screen.findByLabelText('Address');

        fireEvent.change(address, { target: { value: 'not an address' } });

        expect(await screen.findByText('Enter a valid address')).toBeTruthy();
        expect(messaging.getRecipientPubkey).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Request encrypted session/i })).toBeNull();
    });
});

describe('LinkForm memo limit', () => {
    it('shows a live counter and explains the memo limit when Link is pressed', async () => {
        const messaging = mount(LinkForm);
        const [firstIndex, secondIndex] = await screen.findAllByLabelText('Action to reference');
        fireEvent.change(firstIndex, { target: { value: '11' } });
        fireEvent.change(secondIndex, { target: { value: '22' } });
        const memo = screen.getByLabelText('Memo (optional)');
        const submit = await screen.findByRole('button', { name: 'Link' });

        fireEvent.change(memo, { target: { value: AT_LIMIT } });
        expect(screen.getByText(`${MAX_TEXT_LENGTH} / ${MAX_TEXT_LENGTH} characters.`)).toBeTruthy();
        await waitFor(() => expect(submit.disabled).toBe(false));

        fireEvent.change(memo, { target: { value: OVER_LIMIT } });
        expect(screen.getAllByText(/Memo is 251 characters/).length).toBeGreaterThan(0);
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        expect(screen.getAllByText(/Memo is 251 characters/).length).toBeGreaterThan(1);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('CallbackForm memo limit', () => {
    it('shows a live counter and disables callback past the memo limit', async () => {
        const messaging = mount(CallbackForm, {
            initialChainId: BTC,
            initialTick: 'CALLABLE',
            initialFromAddress: SOURCE.address,
        });
        const memo = await screen.findByLabelText('Memo (optional)');
        const submit = await screen.findByRole('button', { name: 'Execute callback' });

        fireEvent.change(memo, { target: { value: AT_LIMIT } });
        expect(screen.getByText(`${MAX_TEXT_LENGTH} / ${MAX_TEXT_LENGTH} characters.`)).toBeTruthy();
        await waitFor(() => expect(submit.disabled).toBe(false));

        fireEvent.change(memo, { target: { value: OVER_LIMIT } });
        expect(screen.getByText(/Memo is 251 characters/)).toBeTruthy();
        expect(submit.disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
