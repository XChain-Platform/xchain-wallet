// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Compose raises its notices as the first item of the page content: the
// plain-text confirmation and the unknown-recipient-key warning sit above the
// form, never between its fields.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'owner-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: null,
});
const RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function messagingFor(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: OWNER }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecipientPubkey: vi.fn().mockResolvedValue(null),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(messaging, props = {}) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ComposeMessage, {
            walletId: 'wallet-1',
            chainId: CHAIN,
            onBack() {},
            ...props,
        }),
    ));
}

async function settle(ms = 0) {
    await act(async () => {
        vi.advanceTimersByTime(ms);
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

/** The notice is above the form element and outside it, not a line among the fields. */
function expectLeadsPage(container, notice) {
    const form = container.querySelector('form');
    expect(form, 'the compose form').toBeTruthy();
    expect(form.contains(notice), 'a notice drawn inside the form sits among the fields').toBe(false);
    expect(
        notice.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the notice comes before the form in the page',
    ).toBeTruthy();
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('ComposeMessage notices lead the page', () => {
    it('shows the plain-text confirmation above the form and keeps its controls working', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const scrolled = [];
        Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this); };
        const utils = mount(messagingFor());
        await settle();
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: RECIPIENT } });
        await settle(500);

        fireEvent.click(screen.getByRole('button', { name: /^Encryption:/ }));
        fireEvent.click(screen.getByRole('option', { name: /Plain text/ }));

        const accept = screen.getByRole('button', { name: 'Send as plain text' });
        const notice = accept.closest('[role="alert"]');
        expect(notice.textContent).toMatch(/Send this message as plain text\?/);
        expectLeadsPage(utils.container, notice);
        // The control shows the pending choice, the confirmation is scrolled
        // into view, and focus lands on its safe button.
        expect(screen.getByRole('button', { name: /^Encryption: Plain text/ })).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep encrypted' }));
        expect(scrolled).toContain(notice);

        fireEvent.click(accept);
        expect(screen.queryByRole('button', { name: 'Send as plain text' })).toBeNull();
        expect(screen.getByRole('button', { name: /^Encryption: Plain text/ })).toBeTruthy();
    });

    it('declining the confirmation keeps the encrypted method', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        mount(messagingFor());
        await settle();
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: RECIPIENT } });
        await settle(500);
        fireEvent.click(screen.getByRole('button', { name: /^Encryption:/ }));
        fireEvent.click(screen.getByRole('option', { name: /Plain text/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep encrypted' }));
        expect(screen.queryByRole('button', { name: 'Send as plain text' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Encryption: Plain text/ })).toBeNull();
        expect(screen.getByRole('button', { name: /^Encryption: Standard/ })).toBeTruthy();
    });

    it('shows the unknown-recipient-key warning above the form with its request button', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const utils = mount(messagingFor());
        await settle();
        fireEvent.change(screen.getByLabelText('Address'), { target: { value: RECIPIENT } });
        await settle(500);

        const notice = screen.getByRole('alert');
        expect(notice.textContent).toMatch(/don't know the recipient's public key/);
        expectLeadsPage(utils.container, notice);
        const request = screen.getByRole('button', { name: /Request encrypted session/ });
        expect(notice.contains(request)).toBe(true);
    });
});

describe('every plaintext send shows the warning first', () => {
    const composed = {
        psbt: 'aa00',
        encoding: 'psbt',
        actionString: 'MESSAGE|0|BTC|bc1qdevmock02ddeeff|2|02aabbcc',
        version: 0,
        chainId: CHAIN,
    };

    function replyMessaging() {
        return messagingFor({
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
            composeMessageForConfirm: vi.fn().mockResolvedValue(composed),
            composeForConfirm: vi.fn().mockResolvedValue(composed),
        });
    }

    async function pressSend() {
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Send message/i }));
            for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
    }

    it('asks before a reply in a plaintext thread goes to review, and sends once accepted', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const messaging = replyMessaging();
        const utils = mount(messaging, {
            toAddress: RECIPIENT,
            initialMessage: 'a reply',
            fixedEncryption: 'plaintext',
        });
        await settle(500);

        await pressSend();
        expect(screen.queryByTestId('confirm-modal'), 'a plaintext reply reached review with no warning').toBeNull();
        expect(messaging.composeMessageForConfirm).not.toHaveBeenCalled();
        const accept = screen.getByRole('button', { name: 'Send as plain text' });
        const notice = accept.closest('[role="alert"]');
        expect(notice.textContent).toMatch(/Anyone can read it on the blockchain/);
        expectLeadsPage(utils.container, notice);
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

        await act(async () => {
            fireEvent.click(accept);
            for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
        expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('confirm-modal')).toBeTruthy();
    });

    it('asks again for the next plaintext send', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const messaging = replyMessaging();
        mount(messaging, {
            toAddress: RECIPIENT,
            initialMessage: 'a reply',
            fixedEncryption: 'plaintext',
        });
        await settle(500);

        await pressSend();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Send as plain text' }));
            for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
        expect(screen.getByTestId('confirm-modal')).toBeTruthy();
        // Reject the review, then send again: the warning returns.
        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-reject'));
            for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
        await pressSend();
        expect(screen.getByRole('button', { name: 'Send as plain text' })).toBeTruthy();
        expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
    });

    it('cancelling the warning sends nothing', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const messaging = replyMessaging();
        mount(messaging, {
            toAddress: RECIPIENT,
            initialMessage: 'a reply',
            fixedEncryption: 'plaintext',
        });
        await settle(500);
        await pressSend();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('button', { name: 'Send as plain text' })).toBeNull();
        expect(messaging.composeMessageForConfirm).not.toHaveBeenCalled();
    });

    it('a menu pick of Plain text is confirmed once, then the send goes ahead without a second ask', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const messaging = replyMessaging();
        mount(messaging, { toAddress: RECIPIENT, initialMessage: 'hello' });
        await settle(500);
        fireEvent.click(screen.getByRole('button', { name: /^Encryption:/ }));
        fireEvent.click(screen.getByRole('option', { name: /Plain text/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Send as plain text' }));

        await pressSend();
        expect(screen.queryByRole('button', { name: 'Send as plain text' })).toBeNull();
        expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
    });
});
