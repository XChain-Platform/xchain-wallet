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
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import {
    memoLength,
    memoLengthError,
} from '../../../packages/core/src/shared/utils/memoLimit.js';
import {
    MAX_MESSAGE_BYTES,
    messageWireByteLength,
} from '../../../packages/core/src/flows/messageAction.js';

const MAX_TEXT_LENGTH = 250;
const AT_LIMIT = '😀'.repeat(MAX_TEXT_LENGTH / 2);
const OVER_LIMIT = `${AT_LIMIT}a`;
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

function messagingFor(overrides = {}) {
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
            callbackBlock: '1',
        }),
        tokenHolderSummary: vi.fn().mockResolvedValue({ recipientCount: 1, totalPayout: '1' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', tick: 'JDOG', amount: '1' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        composeMessageForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'MESSAGE', version: 2,
            messageParams: {},
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
}

function mount(Component, props = {}, messagingOverrides = {}) {
    const messaging = messagingFor(messagingOverrides);
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

describe('memo text measurement', () => {
    it('counts UTF-16 units and gives an explicit memo refusal', () => {
        expect(memoLength('aé📦')).toBe(4);
        expect(memoLengthError(AT_LIMIT)).toBeNull();
        expect(memoLengthError(OVER_LIMIT)).toBe(
            `Memo is ${MAX_TEXT_LENGTH + 1} characters; the network accepts at most ${MAX_TEXT_LENGTH} characters.`,
        );
    });
});

describe('BroadcastForm text limits', () => {
    it('passes a valid multibyte message to compose without changing it', async () => {
        const messaging = mount(BroadcastForm, { initialChainId: BTC });
        const message = await screen.findByLabelText('Message');

        fireEvent.change(message, { target: { value: AT_LIMIT } });
        fireEvent.click(screen.getByRole('button', { name: 'Announce' }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.MESSAGE).toBe(AT_LIMIT);
    });

    it('shows a live counter and disables Broadcast past the message limit', async () => {
        const messaging = mount(BroadcastForm, { initialChainId: BTC });
        const message = await screen.findByLabelText('Message');
        const submit = screen.getByRole('button', { name: 'Announce' });
        const atLimit = '😀'.repeat(MAX_TEXT_LENGTH / 2);
        const overLimit = `${atLimit}a`;

        fireEvent.change(message, { target: { value: atLimit } });
        expect(screen.getByText(`${MAX_TEXT_LENGTH} / ${MAX_TEXT_LENGTH}`)).toBeTruthy();
        await waitFor(() => expect(submit.disabled).toBe(false));

        fireEvent.change(message, { target: { value: overLimit } });
        expect(screen.getAllByText(`Message is ${MAX_TEXT_LENGTH + 1} characters; the network accepts at most ${MAX_TEXT_LENGTH} characters.`).length).toBeGreaterThan(0);
        // G22: Announce stays enabled; a press past the limit is refused.
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        await waitFor(() => expect(screen.getAllByText(/the network accepts at most/).length).toBeGreaterThan(0));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a direction override before compose', async () => {
        const messaging = mount(BroadcastForm, { initialChainId: BTC });
        const message = await screen.findByLabelText('Message');

        fireEvent.change(message, { target: { value: 'safe\u202eunsafe' } });

        expect(screen.getAllByText('Message cannot contain text-direction control characters.').length).toBeGreaterThan(0);
        // G22: Announce stays enabled; the press is refused before compose.
        const submit = screen.getByRole('button', { name: 'Announce' });
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        await waitFor(() => expect(screen.getAllByText('Message cannot contain text-direction control characters.').length).toBeGreaterThan(0));
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
        const submit = screen.getByRole('button', { name: 'Send Message' });

        fireEvent.change(message, { target: { value: '📦' } });
        // Hidden until the message reaches 80% of the limit.
        expect(screen.queryByText(/ of 1 MB$/)).toBeNull();
        expect(submit.disabled).toBe(false);

        fireEvent.change(message, { target: { value: 'a'.repeat(900000) } });
        const counter = screen.getByText(/^\d+(\.\d)? KB of 1 MB$/);
        // The message's own size rounds up (shared formatBytes): 878.9x KB reads 879 KB.
        expect(counter.textContent).toBe('879 KB of 1 MB');
        expect(counter).toHaveAttribute('aria-live', 'polite');

        fireEvent.change(message, { target: { value: `${'é'.repeat(MAX_MESSAGE_BYTES / 2)}a` } });
        expect(screen.getByText(
            `Message is ${(MAX_MESSAGE_BYTES + 1).toLocaleString()} bytes; the network accepts at most ${MAX_MESSAGE_BYTES.toLocaleString()} bytes.`,
        )).toBeTruthy();
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        expect(screen.getAllByText(/the network accepts at most/).length).toBeGreaterThan(1);
        expect(messaging.composeMessageForConfirm).not.toHaveBeenCalled();
    });

    it('counts the encrypted protocol field and blocks ECIES ciphertext past its limit', async () => {
        const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const messaging = mount(ComposeMessage, { chainId: BTC, toAddress: recipient });
        const message = await screen.findByLabelText('Message');
        const submit = screen.getByRole('button', { name: 'Send Message' });
        const atLimit = 'é'.repeat((MAX_MESSAGE_BYTES / 2 - 62) / 2);

        fireEvent.change(message, { target: { value: atLimit } });
        expect(messageWireByteLength(atLimit, 1)).toBe(MAX_MESSAGE_BYTES);
        expect(screen.getByText('1 MB of 1 MB')).toBeTruthy();
        expect(submit.disabled).toBe(false);

        fireEvent.change(message, { target: { value: `${atLimit}a` } });
        expect(screen.getByText(
            `Encrypted message is ${(MAX_MESSAGE_BYTES + 2).toLocaleString()} bytes; the network accepts at most ${MAX_MESSAGE_BYTES.toLocaleString()} bytes.`,
        )).toBeTruthy();
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        expect(screen.getAllByText(/the network accepts at most/).length).toBeGreaterThan(1);
        expect(messaging.composeMessageForConfirm).not.toHaveBeenCalled();
    });

    it('requires confirmation before selecting the missing-key plaintext fallback', async () => {
        const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        mount(
            ComposeMessage,
            { chainId: BTC, toAddress: recipient },
            { getRecipientPubkey: vi.fn().mockResolvedValue(null) },
        );

        expect(await screen.findByText(/we can't encrypt/i)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Encryption: Standard/ }));
        fireEvent.click(screen.getByRole('option', { name: /Plain text/ }));

        expect(screen.getByRole('button', { name: /Encryption: Plain text/ })).toBeTruthy();
        expect(screen.getByText(/Send this message as plain text/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Send as plain text' }));
        expect(screen.getByRole('button', { name: /Encryption: Plain text/ })).toBeTruthy();
    });

    it('refuses a whitespace-only message before compose', async () => {
        const recipient = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const messaging = mount(ComposeMessage, {
            chainId: BTC,
            fixedEncryption: 'plaintext',
            toAddress: recipient,
        });
        const message = await screen.findByLabelText('Message');

        fireEvent.change(message, { target: { value: '   \n  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));

        expect(await screen.findAllByText('Write a message to send.')).toHaveLength(2);
        expect(messaging.composeMessageForConfirm).not.toHaveBeenCalled();
    });

    it('does not look up a key or offer a session request for an invalid recipient', async () => {
        const messaging = mount(ComposeMessage, { chainId: BTC });
        const address = await screen.findByLabelText('Address');

        fireEvent.change(address, { target: { value: 'not an address' } });

        expect(await screen.findByText('Enter a valid address')).toBeTruthy();
        expect(messaging.getRecipientPubkey).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Request Encrypted Session (Publish Your Key)' })).toBeNull();
    });

    it('has no attachment field', async () => {
        mount(ComposeMessage, {
            chainId: BTC,
            fixedEncryption: 'plaintext',
            toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        });
        await screen.findByLabelText('Message');

        expect(screen.queryByLabelText(/attach/i)).toBeNull();
        expect(screen.queryByText(/attach/i)).toBeNull();
        expect(document.querySelector('input[type="file"]')).toBeNull();
    });
});

describe('LinkForm memo limit', () => {
    it('shows a live counter and explains the memo limit when Link Actions is pressed', async () => {
        const messaging = mount(LinkForm);
        const [firstIndex, secondIndex] = await screen.findAllByLabelText('Action number');
        fireEvent.change(firstIndex, { target: { value: '11' } });
        fireEvent.change(secondIndex, { target: { value: '22' } });
        const memo = screen.getByLabelText('Memo');
        const submit = await screen.findByRole('button', { name: 'Link Actions' });

        fireEvent.change(memo, { target: { value: AT_LIMIT } });
        expect(screen.getByText(`${MAX_TEXT_LENGTH} / ${MAX_TEXT_LENGTH}`)).toBeTruthy();
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
        const memo = await screen.findByLabelText('Memo');
        const submit = await screen.findByRole('button', { name: 'Recall Tokens' });

        fireEvent.change(memo, { target: { value: AT_LIMIT } });
        expect(screen.getByText(`${MAX_TEXT_LENGTH} / ${MAX_TEXT_LENGTH}`)).toBeTruthy();
        await waitFor(() => expect(submit.disabled).toBe(false));

        fireEvent.change(memo, { target: { value: OVER_LIMIT } });
        expect(screen.getAllByText(/Memo is 251 characters/).length).toBeGreaterThan(0);
        // G22: the button stays enabled; a press past the limit is refused.
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        await waitFor(() => expect(screen.getAllByText(/Memo is 251 characters/).length).toBeGreaterThan(0));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a control character before compose', async () => {
        const messaging = mount(CallbackForm, {
            initialChainId: BTC,
            initialTick: 'CALLABLE',
            initialFromAddress: SOURCE.address,
        });
        const memo = await screen.findByLabelText('Memo');

        fireEvent.change(memo, { target: { value: 'safe\u0000unsafe' } });

        expect(screen.getAllByText('Memo cannot contain control characters.').length).toBeGreaterThan(0);
        // G22: the button stays enabled; the press is refused before compose.
        const submit = screen.getByRole('button', { name: 'Recall Tokens' });
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        await waitFor(() => expect(screen.getAllByText('Memo cannot contain control characters.').length).toBeGreaterThan(0));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
