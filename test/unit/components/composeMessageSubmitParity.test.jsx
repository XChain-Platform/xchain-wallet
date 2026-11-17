// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the compose screen's two submit paths build the same request and show
// the same failure for the same error, driven through the real component.
//
// The confirm path is the one every real send takes. The legacy review stage
// (its Approve) keeps its own handler; a demo id is cleared between the
// review screen and the press so that handler runs its host call, which is the
// only way a render test can reach it without a locked wallet holding a
// password. Each assertion reads what reached the host or the alert, so a
// drift in either handler's payload or failure wording turns a test red.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';

// The legacy review stage is only entered for a wallet the form treats as a
// demo wallet at render time. The flag lets a test turn that off again before
// Approve, so the handler's host call runs; the demo guard reads the real
// module and stays off.
const demoFlag = { on: false };
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, isDemoWallet: (id) => demoFlag.on && id === 'wallet-parity' },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';
const WALLET = 'wallet-parity';
const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: null,
});
const RECIPIENT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const EXPECTED_BASE = Object.freeze({
    walletId: WALLET,
    chainId: CHAIN,
    broadcastChainId: CHAIN,
    from: {
        address: ADDRESS.address,
        publicKey: ADDRESS.publicKey,
        derivationPath: ADDRESS.derivationPath,
        addressId: ADDRESS.id,
        source: ADDRESS.source,
        signerId: ADDRESS.signerId,
    },
    destination: RECIPIENT,
    message: 'hello there',
    method: 1,
});

function namedError(name, message) {
    return Object.assign(new Error(message), { name });
}

// Each case is the wording a user must read whichever path threw.
const FAILURES = [
    ['InvalidPasswordError', namedError('InvalidPasswordError', 'bad pw'), /Incorrect password\./],
    ['PubkeyNotFoundError', namedError('PubkeyNotFoundError', 'no key'), /recipient's encryption key is no longer available/],
    ['PubkeyMismatchError', namedError('PubkeyMismatchError', 'mismatch'), /doesn't belong to their address/],
    ['a funding shortfall', new Error('insufficient funds: selected inputs total 5808 but 6454 is required'), /enough funds/],
];

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

afterEach(() => {
    demoFlag.on = false;
});

async function drain(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function stubMessaging(overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: ADDRESS }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        listContacts: () => Promise.resolve([]),
        getRecipientPubkey: () => Promise.resolve('02' + 'ab'.repeat(32)),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        composeMessageForConfirm: vi.fn(() => Promise.reject(new Error('unset'))),
        messageAction: vi.fn(() => Promise.reject(new Error('unset'))),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ txid: `tx-${String(prop)}`, rows: [] });
        },
    });
}

async function openFilledForm(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ComposeMessage, { walletId: WALLET, chainId: CHAIN, onBack() {} }),
            ),
        );
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Address'), { target: { value: RECIPIENT } });
        fireEvent.change(utils.getByLabelText('Message'), { target: { value: 'hello there' } });
        await drain();
    });
    await domAct(async () => {
        vi.advanceTimersByTime(500);
        await drain();
    });
    return utils;
}

async function click(utils, name) {
    const button = utils.getByRole('button', { name });
    expect(button.disabled, `${name} was disabled, so nothing below was exercised`).toBe(false);
    await domAct(async () => {
        fireEvent.click(button);
        await drain(20);
    });
}

function alertText(utils) {
    return Array.from(utils.container.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent || '')
        .join(' | ');
}

/** Opens the review screen, then turns the demo flag off so Approve runs the host call. */
async function openLegacyReview(messaging) {
    demoFlag.on = true;
    const utils = await openFilledForm(messaging);
    await click(utils, /Send message/i);
    expect(utils.getByRole('button', { name: /^Approve$/ }), 'the review stage never opened').toBeTruthy();
    expect(messaging.composeMessageForConfirm, 'the confirm path ran instead of the review stage').not.toHaveBeenCalled();
    demoFlag.on = false;
    return utils;
}

describe('the confirm path and the legacy review path share one request and one failure mapping', () => {
    it('sends the same request body from both paths', async () => {
        const confirm = stubMessaging({ composeMessageForConfirm: vi.fn(() => Promise.reject(new Error('stop'))) });
        const confirmUtils = await openFilledForm(confirm);
        await click(confirmUtils, /Send message/i);
        const composed = confirm.composeMessageForConfirm.mock.calls[0][0];
        confirmUtils.unmount();

        const legacy = stubMessaging({ messageAction: vi.fn(() => Promise.reject(new Error('stop'))) });
        const legacyUtils = await openLegacyReview(legacy);
        await click(legacyUtils, /^Approve$/);
        const { password, ...submitted } = legacy.messageAction.mock.calls[0][0];

        expect(composed).toMatchObject(EXPECTED_BASE);
        const { feePerKb, ...submittedCore } = submitted;
        expect(submittedCore).toEqual({ ...EXPECTED_BASE });
        expect(feePerKb, 'the picked fee rate was dropped from the legacy request').toBe(composed.feePerKb);
        expect(feePerKb).toBeGreaterThan(0);
        expect(password).toBe('');
        const { prebuiltPsbt, prebuiltParams, ...composedCore } = composed;
        expect(composedCore).toMatchObject(submitted);
    });

    for (const [label, error, wording] of FAILURES) {
        it(`shows the same wording for ${label} on the confirm path`, async () => {
            const messaging = stubMessaging({ composeMessageForConfirm: vi.fn(() => Promise.reject(error)) });
            const utils = await openFilledForm(messaging);
            await click(utils, /Send message/i);
            expect(messaging.composeMessageForConfirm).toHaveBeenCalledTimes(1);
            expect(alertText(utils)).toMatch(wording);
        });

        it(`shows the same wording for ${label} on the legacy review path`, async () => {
            const messaging = stubMessaging({ messageAction: vi.fn(() => Promise.reject(error)) });
            const utils = await openLegacyReview(messaging);
            await click(utils, /^Approve$/);
            expect(messaging.messageAction).toHaveBeenCalledTimes(1);
            expect(alertText(utils)).toMatch(wording);
            expect(utils.getByRole('button', { name: /^Approve$/ }), 'the review stage was left after a failure')
                .toBeTruthy();
        });
    }

    it('hands the legacy path result to the caller', async () => {
        const messaging = stubMessaging({ messageAction: vi.fn(() => Promise.resolve({ txid: 'tx-legacy' })) });
        const utils = await openLegacyReview(messaging);
        await click(utils, /^Approve$/);
        expect(messaging.messageAction).toHaveBeenCalledTimes(1);
        expect(alertText(utils)).toBe('');
        expect(utils.queryByRole('button', { name: /^Approve$/ })).toBeNull();
    });
});
