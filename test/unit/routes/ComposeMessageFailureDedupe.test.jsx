// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a failed send draws its failure once. The collapsed details control
// must not repeat the primary message.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';
// Listed FIRST on the chain: the address the broken build always funded from.
const FIRST_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    publicKey: '02aabbcc',
    derivationPath: "m/44'/0'/0'/0/0",
    source: 'hd',
    signerId: null,
});
// Listed second, and the chain's ACTIVE address: where the user keeps funds.
const ACTIVE_ADDRESS = Object.freeze({
    id: 'addr-hd-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: null,
});
// BIP173 test vector: checksum-valid, so the address guard lets the send
// through. The stub below answers its pubkey lookup with a key, so the form
// takes the default encrypted path and the Send button is enabled.
const RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';


beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function stubMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [FIRST_ADDRESS, ACTIVE_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: ACTIVE_ADDRESS }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        listContacts: () => Promise.resolve([]),
        getRecipientPubkey: () => Promise.resolve('02' + 'ab'.repeat(32)),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        // The host-side compose is where a funding failure surfaces. It
        // rejects by default so no test here depends on the confirm screen;
        // what each test reads is what the form did with the rejection and
        // which address it composed for.
        composeMessageForConfirm: vi.fn(() => Promise.reject(FAILURE)),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ txid: `tx-${String(prop)}`, rows: [] });
        },
    });
}

/** Mounts the screen with a recipient and body filled in and the key lookup settled. */
async function openFilledForm(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ComposeMessage, {
                    walletId: 'w', chainId: CHAIN, onBack() {},
                }),
            ),
        );
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Address'), { target: { value: RECIPIENT } });
        fireEvent.change(utils.getByLabelText('Message'), { target: { value: 'hello there' } });
        await drainMicrotasks();
    });
    // Settle the debounced recipient-key lookup before testing the encrypted path.
    await domAct(async () => {
        vi.advanceTimersByTime(500);
        await drainMicrotasks();
    });
    return utils;
}

async function openEmptyPlaintextForm(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ComposeMessage, {
                    walletId: 'w', chainId: CHAIN, fixedEncryption: 'plaintext', onBack() {},
                }),
            ),
        );
        await drainMicrotasks();
    });
    return utils;
}

function sendButton(utils) {
    return utils.getByRole('button', { name: /Send message/i });
}

async function pressSend(utils) {
    // A disabled button would make every assertion below vacuous: nothing
    // pressed, nothing composed, no error to show or not show.
    expect(sendButton(utils).disabled, 'Send message was disabled, so nothing below was exercised')
        .toBe(false);
    await domAct(async () => {
        fireEvent.click(sendButton(utils));
        await drainMicrotasks(20);
    });
}

/** Every alert the screen is currently showing, as text. */
function alertText(utils) {
    return Array.from(utils.container.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent || '')
        .join(' | ');
}

class SDKValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SDKValidationError';
    }
}

// The builder's terse wording is restated as a sentence by the message path
// and is also classified as raw technical text, so the same words reach both.
const FAILURE = new SDKValidationError('internal error');

describe('a failed send does not render the same failure twice', () => {
    it('keeps the primary message and the collapsed details distinct', async () => {
        const messaging = stubMessaging();
        const utils = await openFilledForm(messaging);
        await pressSend(utils);

        expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
        const alert = utils.container.querySelector('[role="alert"]');
        expect(alert, 'no failure was rendered').not.toBeNull();
        const shown = (alert.textContent || '').toLowerCase();
        const occurrences = shown.split('internal error').length - 1;
        expect(occurrences, 'the failure text is drawn more than once: ' + shown).toBe(1);
        expect(utils.container.querySelector('details'), 'a details control repeats the message').toBeNull();
    });
});
