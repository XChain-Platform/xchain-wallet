// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the compose screen's Send path, driven through the real component.
//
// Two defects an external tester found together (GitHub xchain-wallet #11 and
// #12), and they compound: the message was funded from the FIRST address on
// the delivery chain rather than the chain's active one, so a wallet whose
// first address was empty could not send at all; and when that compose failed
// the reason landed in `submitError`, which the form stage rendered nowhere,
// so Send message looked like a button that does nothing.
//
// Both are proven here on what reaches the screen and what reaches the host,
// because a test of either handler in isolation passed against the broken
// build: the auto-pick effect DID pick an address, and the catch DID store the
// error. What was wrong was which address, and where the error went.

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

const INSUFFICIENT = 'insufficient funds: selected inputs total 5808 but 6454 is required (outputs 3845 + fee 2609)';

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
        composeMessageForConfirm: vi.fn(() => Promise.reject(new Error(INSUFFICIENT))),
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
    // The recipient-pubkey lookup is debounced; the Send button stays disabled
    // until it settles.
    await domAct(async () => {
        vi.advanceTimersByTime(500);
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

describe('a failed compose is shown on the form stage (issue #12)', () => {
    it('renders the host reason where Send was pressed, and clears it on the next edit', async () => {
        const messaging = stubMessaging();
        const utils = await openFilledForm(messaging);

        expect(alertText(utils), 'a failure is being reported for an attempt nobody made')
            .not.toMatch(/insufficient/i);

        await pressSend(utils);

        expect(messaging.composeMessageForConfirm, 'the press never reached the host compose')
            .toHaveBeenCalledTimes(1);
        // THE CLAIM. Before the fix the rejection was stored and never drawn:
        // no alert, no navigation, the button back to idle as if nothing
        // happened.
        expect(alertText(utils), 'the compose failure was swallowed: nothing on the form stage reports it')
            .toMatch(/insufficient funds/i);
        expect(alertText(utils)).toMatch(/6454 is required/);

        // The next edit of the message is a new attempt in the making, so the
        // old verdict comes down rather than sitting beside fresh input.
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Message'), { target: { value: 'hello there again' } });
            await drainMicrotasks();
        });
        expect(alertText(utils), 'a stale failure survived an edit').not.toMatch(/insufficient/i);
    });

    it('shows nothing for a compose that succeeds', async () => {
        // The control for the block above: the alert has to be the failure's,
        // not a fixture of the form. A resolving compose hands off to the
        // confirm flow, and whatever that does next is not this file's
        // subject; what must NOT appear is an error.
        const messaging = stubMessaging({
            composeMessageForConfirm: vi.fn(() => new Promise(() => {})),
        });
        const utils = await openFilledForm(messaging);
        await pressSend(utils);
        expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
        expect(alertText(utils), 'an error was reported for a compose that did not fail')
            .not.toMatch(/insufficient|failed/i);
    });
});

describe('the message is funded from the active address (issue #11)', () => {
    /** The `from` the host was asked to compose for. */
    function composedFrom(messaging) {
        expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
        return messaging.composeMessageForConfirm.mock.calls[0][0].from;
    }

    it('composes for the chain\'s active address, not the first one listed', async () => {
        const messaging = stubMessaging();
        const utils = await openFilledForm(messaging);
        await pressSend(utils);

        const from = composedFrom(messaging);
        // Before the fix this was FIRST_ADDRESS on every wallet, however the
        // user had arranged their funds.
        expect(from.addressId, 'funded from the first-listed address instead of the active one')
            .toBe(ACTIVE_ADDRESS.id);
        expect(from.address).toBe(ACTIVE_ADDRESS.address);
        expect(from.publicKey).toBe(ACTIVE_ADDRESS.publicKey);
    });

    it('falls back to the first HD address when the chain has no active address', async () => {
        const messaging = stubMessaging({ getActiveAddresses: () => Promise.resolve({}) });
        const utils = await openFilledForm(messaging);
        await pressSend(utils);
        expect(composedFrom(messaging).addressId).toBe(FIRST_ADDRESS.id);
    });

    it('ignores an active address the wallet no longer holds on that chain', async () => {
        const messaging = stubMessaging({
            getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: 'addr-gone', address: '1gone' } }),
        });
        const utils = await openFilledForm(messaging);
        await pressSend(utils);
        expect(composedFrom(messaging).addressId).toBe(FIRST_ADDRESS.id);
    });

    it('still works on a host that cannot report active addresses', async () => {
        // A shell without the method, and one whose call fails, both keep the
        // pre-fix behaviour rather than a form with no funding address.
        for (const getActiveAddresses of [undefined, () => Promise.reject(new Error('no such route'))]) {
            const messaging = stubMessaging({ getActiveAddresses });
            const utils = await openFilledForm(messaging);
            await pressSend(utils);
            expect(composedFrom(messaging).addressId).toBe(FIRST_ADDRESS.id);
            utils.unmount();
        }
    });

    it('follows the active address of the delivery network the user switches to', async () => {
        const LTC = 'litecoin-mainnet';
        const ltcFirst = { ...FIRST_ADDRESS, id: 'ltc-hd-0', address: 'LM2WMpR1Rp6j3Sa59cMXMs1SPzj9eXpGc1' };
        const ltcActive = { ...ACTIVE_ADDRESS, id: 'ltc-hd-1', address: 'ltc1qexampleexampleexampleexampleexampleex' };
        const messaging = stubMessaging({
            getAddressesByChain: () => Promise.resolve({
                [CHAIN]: [FIRST_ADDRESS, ACTIVE_ADDRESS],
                [LTC]: [ltcFirst, ltcActive],
            }),
            getActiveAddresses: () => Promise.resolve({ [CHAIN]: ACTIVE_ADDRESS, [LTC]: ltcActive }),
        });
        const utils = await openFilledForm(messaging);

        // IconSelect is a button + listbox popover, not a native select: open
        // it by its accessible name, then pick the Litecoin row.
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /^Delivery network:/ }));
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('option', { name: /^Litecoin\b/ }));
            await drainMicrotasks();
        });
        await pressSend(utils);

        const call = messaging.composeMessageForConfirm.mock.calls[0][0];
        expect(call.broadcastChainId).toBe(LTC);
        expect(call.from.addressId, 'switching delivery network fell back to the first-listed address')
            .toBe(ltcActive.id);
    });
});
