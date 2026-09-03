// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a failed message key-request must not be invisible.
//
// The "Request encrypted session (publish your key)" button is the FIRST
// CONTACT surface: it is the only way to message an address the chain has
// never seen. Every one of its failures used to write into `submitError`,
// which the form stage renders nowhere (only the review stage and the hardware
// branch do), so pressing it did nothing, silently, forever. The locked-wallet
// branch was worse than silent: it asked for a password on a stage that has no
// password field, so even a user who could read it had nothing to type into.
//
// Both branches are driven here through the real component, because the defect
// was entirely in what reaches the SCREEN - a unit test of the handler would
// have passed against the broken build.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: null,
});
// A recipient the chain has never seen: `getRecipientPubkey` answers null, so
// the wallet cannot encrypt and the handshake box appears. That box is the
// only place the button under test exists.
const UNKNOWN_RECIPIENT = 'bc1qdevmock02ddeeff';

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
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        listContacts: () => Promise.resolve([]),
        // The recipient is unknown to the chain: this is what puts the wallet
        // on the handshake path in the first place.
        getRecipientPubkey: () => Promise.resolve(null),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ txid: `tx-${String(prop)}`, rows: [] });
        },
    });
}

/** Mounts the screen and gets it as far as the handshake box. */
async function openHandshakeBox(messaging) {
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
        fireEvent.change(utils.getByLabelText('Address'), { target: { value: UNKNOWN_RECIPIENT } });
        fireEvent.change(utils.getByLabelText('Message'), { target: { value: 'hello there' } });
        await drainMicrotasks();
    });
    // The recipient-pubkey lookup is debounced; without this the box is still
    // in its `checking` state and the button does not exist yet.
    await domAct(async () => {
        vi.advanceTimersByTime(500);
        await drainMicrotasks();
    });
    return utils;
}

function requestButton(utils) {
    return utils.getByRole('button', { name: /Request encrypted session/i });
}

/** Every alert the screen is currently showing, as text. */
function alertText(utils) {
    return Array.from(utils.container.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent || '')
        .join(' | ');
}

describe('the message key-request reports its failures', () => {
    it('says the wallet is LOCKED, and names something the user can do about it', async () => {
        // The exact state the defect was found in: the signer pool did not
        // rehydrate, so `signerReady` is false and there is no password field
        // on this stage to satisfy it with.
        const messaging = stubMessaging({ signerReady: () => Promise.resolve({ ready: false }) });
        const utils = await openHandshakeBox(messaging);

        await domAct(async () => {
            fireEvent.click(requestButton(utils));
            await drainMicrotasks();
        });

        const said = alertText(utils);
        expect(said, 'a failed key request must not be silent').toMatch(/locked/i);
        expect(said, 'unlocking is the remedy the user can actually reach').toMatch(/unlock/i);
        // The old copy sent the user to a password field that does not exist on
        // this stage. Asking for a password here is the defect, not the fix.
        expect(said, 'this stage has no password field to enter one into')
            .not.toMatch(/enter your password/i);
    });

    it('tells a legacy 25th-word passphrase wallet the truth instead of sending it round the unlock loop', async () => {
        // The same `!signerReady` branch as above, and a DIFFERENT sentence is
        // owed. This wallet is not locked: `SignerPool.populate` skips a
        // legacy passphrase wallet (`passphraseEnabled` true, nothing stored
        // yet) on purpose, and no field on THIS screen can supply the
        // passphrase, so "unlock it and press this again" is an instruction
        // that can never succeed - the same class of un-compliable copy this
        // whole error state exists to kill.
        const messaging = stubMessaging({
            signerReady: () => Promise.resolve({ ready: false }),
            listWallets: () => Promise.resolve([{ id: 'w', passphraseEnabled: true, passphraseStored: false }]),
        });
        const utils = await openHandshakeBox(messaging);

        await domAct(async () => {
            fireEvent.click(requestButton(utils));
            await drainMicrotasks();
        });

        const said = alertText(utils);
        expect(said, 'the reason does not name why this wallet has no signer')
            .toMatch(/25th-word passphrase/i);
        expect(said, 'names the unlock screen as the remedy, not typing on this screen')
            .toMatch(/unlock screen/i);
        expect(said, 'a wallet that is not locked was told it was locked')
            .not.toMatch(/wallet is locked/i);
        // The banner it renders inside already offers Plain text; the reason
        // has to point at it, because it is the only way forward this wallet
        // has for a first-contact message.
        expect(said, 'no remedy this wallet can actually reach was named')
            .toMatch(/plain text/i);
    });

    it('gives a wallet with a STORED passphrase the plain locked message, not the capture one', async () => {
        // A stored passphrase (§3.4) makes the password the only secret the
        // unlock needs, so a not-ready signer here really is just locked: the
        // generic "unlock it and press this again" is true and sufficient.
        // Reading `passphraseEnabled` alone (without `passphraseStored`) would
        // wrongly send this wallet the legacy capture sentence instead.
        const messaging = stubMessaging({
            signerReady: () => Promise.resolve({ ready: false }),
            listWallets: () => Promise.resolve([{ id: 'w', passphraseEnabled: true, passphraseStored: true }]),
        });
        const utils = await openHandshakeBox(messaging);

        await domAct(async () => {
            fireEvent.click(requestButton(utils));
            await drainMicrotasks();
        });

        const said = alertText(utils);
        expect(said, 'a stored-passphrase wallet gets the generic locked message')
            .toMatch(/locked/i);
        expect(said, 'the one-time capture sentence does not apply once it is stored')
            .not.toMatch(/25th-word passphrase that has not been stored/i);
    });

    it('surfaces a REFUSED send instead of swallowing it', async () => {
        const messaging = stubMessaging({
            sendHandshake: () => Promise.reject(new Error('the chain refused the handshake')),
        });
        const utils = await openHandshakeBox(messaging);

        await domAct(async () => {
            fireEvent.click(requestButton(utils));
            await drainMicrotasks();
        });

        expect(alertText(utils)).toMatch(/the chain refused the handshake/);
    });

    it('shows nothing before the button is pressed, and confirms a send that works', async () => {
        const messaging = stubMessaging({ sendHandshake: () => Promise.resolve({ txid: 'tx-ok' }) });
        const utils = await openHandshakeBox(messaging);

        // The box explains the missing key; what it must NOT carry yet is a
        // failure for an attempt nobody has made.
        expect(alertText(utils), 'no failure before an attempt').not.toMatch(/locked|refused/i);

        await domAct(async () => {
            fireEvent.click(requestButton(utils));
            await drainMicrotasks();
        });

        expect(utils.container.textContent, 'a successful request reports itself')
            .toMatch(/Key request sent/i);
        expect(alertText(utils), 'and reports no failure alongside it').not.toMatch(/locked|refused/i);
    });
});
