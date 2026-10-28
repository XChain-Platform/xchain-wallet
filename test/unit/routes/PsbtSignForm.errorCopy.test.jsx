// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Sign-a-transaction screen shows plain copy when a paste cannot be read
// or a broadcast fails, never the host handler's `psbt.parse:` /
// `broadcast.signedTx:` precondition text, decoder exceptions, or shell API names.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { isAutoLockHeld } from '../../../packages/core/src/shared/hooks/autoLockGuard.js';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const OTHER = 'bc1qotherotherotherotherotherotherotherx';
const PSBT_HEX = '70736274ff01000000';

const DECOMPOSED = Object.freeze({
    inputs: [{ address: OWN, value: 100000 }],
    outputs: [{ address: OTHER, value: 90000 }, { address: OWN, value: 5000 }],
});

const ADDRESS = Object.freeze({
    id: 'addr-ledger',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'ledger',
    signerId: 'signer-ledger',
});

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function findButton(utils, re) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => re.test(b.textContent || ''));
}

function alertsText(utils) {
    return Array.from(utils.container.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent || '')
        .join(' | ');
}

// Mount the screen with the hardware lane (no confirm page) and paste a PSBT.
async function mountAndPaste(overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'available' }),
        getSignerInfo: () => Promise.resolve({ kind: 'ledger', status: 'available' }),
        listSigners: () => Promise.resolve([{ id: 'signer-ledger', kind: 'ledger', status: 'available' }]),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        parsePsbtRequest: () => Promise.resolve({ decomposed: DECOMPOSED, action: null, actionDecodeReason: 'NO_OP_RETURN' }),
        signPsbtUserInitiatedHw: () => Promise.resolve({ signedPsbtHex: '', txHex: 'cc22', txid: 'dd33' }),
        ...overrides,
    };
    for (const name of overrides.__absent || []) delete target[name];
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            if (overrides.__absent && overrides.__absent.includes(String(prop))) return undefined;
            return () => Promise.resolve({});
        },
        has(t, prop) {
            if (overrides.__absent && overrides.__absent.includes(String(prop))) return false;
            return true;
        },
    });

    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(PsbtSignForm, { walletId: 'w', onBack() {} }),
            ),
        );
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(/Unsigned transaction/i), { target: { value: PSBT_HEX } });
        await drainMicrotasks();
    });
    return utils;
}

// Sign on the hardware lane, then press Broadcast with the given rejection.
async function broadcastWith(broadcastSignedTxRequest) {
    const overrides = broadcastSignedTxRequest
        ? { broadcastSignedTxRequest }
        : { __absent: ['broadcastSignedTxRequest'] };
    const utils = await mountAndPaste(overrides);
    const submitBtn = findButton(utils, /Sign on (Ledger|Trezor)|Sign transaction/i);
    expect(submitBtn, 'submit button present').toBeTruthy();
    await domAct(async () => {
        fireEvent.click(submitBtn);
        await drainMicrotasks();
    });
    const broadcastBtn = findButton(utils, /^Broadcast$/);
    expect(broadcastBtn, 'reached the result screen with a Broadcast button').toBeTruthy();
    await domAct(async () => {
        fireEvent.click(broadcastBtn);
        await drainMicrotasks();
    });
    return utils;
}

describe('PSBT sign screen: a paste that cannot be read', () => {
    const PARSE_COPY = /doesn't look like a transaction this wallet can read/i;

    it('hides the handler precondition prefix', async () => {
        const utils = await mountAndPaste({
            parsePsbtRequest: () => Promise.reject(new Error('psbt.parse: psbtHex is required')),
        });
        const text = alertsText(utils);
        expect(text).toMatch(PARSE_COPY);
        expect(text).not.toMatch(/psbt\.parse/);
    });

    it('hides a decoder library exception that no prefix filter would catch', async () => {
        const utils = await mountAndPaste({
            parsePsbtRequest: () => Promise.reject(new Error('Format Error: Invalid Magic Number')),
        });
        const text = alertsText(utils);
        expect(text).toMatch(PARSE_COPY);
        expect(text).not.toMatch(/Invalid Magic Number/);
    });

    it('puts the error directly under the paste box with Clear as a link action inside it', async () => {
        const utils = await mountAndPaste({
            parsePsbtRequest: () => Promise.reject(new Error('Format Error: Invalid Magic Number')),
        });
        const textarea = utils.getByLabelText(/Unsigned transaction/i);
        await domAct(async () => {
            fireEvent.change(textarea, { target: { value: 'not a transaction' } });
            await drainMicrotasks();
        });
        const note = utils.container.querySelector('[data-testid="psbt-sign-paste-error"]');
        expect(note).toBeTruthy();
        const clear = Array.from(note.querySelectorAll('button')).find((b) => /^Clear$/.test(b.textContent));
        expect(clear).toBeTruthy();
        const browse = findButton(utils, /Browse for \.psbt file/);
        // Document order: textarea, then the error, then the Browse and Scan buttons.
        expect(textarea.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(note.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await domAct(async () => { fireEvent.click(clear); await drainMicrotasks(); });
        expect(textarea.value).toBe('');
        expect(utils.container.querySelector('[data-testid="psbt-sign-paste-error"]')).toBeNull();
    });

    it('hides the SDK capability error', async () => {
        const utils = await mountAndPaste({
            parsePsbtRequest: () => Promise.reject(new Error('psbt.parse: SDK for "xcp-mainnet" lacks wallet.decomposePsbt')),
        });
        const text = alertsText(utils);
        expect(text).toMatch(PARSE_COPY);
        expect(text).not.toMatch(/decomposePsbt/);
    });

    it('names no shell API when this shell cannot parse at all', async () => {
        const utils = await mountAndPaste({ __absent: ['parsePsbtRequest'] });
        const text = alertsText(utils);
        expect(text).toMatch(/can't read pasted transactions/i);
        expect(text).not.toMatch(/messaging\.|parsePsbtRequest/);
    });
});

describe('PSBT sign screen: a broadcast that fails', () => {
    it('hides a handler precondition behind plain copy', async () => {
        const utils = await broadcastWith(() => Promise.reject(
            new Error('broadcast.signedTx: no registered chain descriptor for "x"'),
        ));
        const text = alertsText(utils);
        expect(text).toMatch(/Couldn't broadcast this transaction\./);
        expect(text).not.toMatch(/broadcast\.signedTx|chain descriptor/);
        expect(text).not.toMatch(/Broadcast failed:/);
    });

    it('turns a node reject code into the network-rejected sentence', async () => {
        const utils = await broadcastWith(() => Promise.reject(new Error('txn-mempool-conflict (code -26)')));
        const text = alertsText(utils);
        expect(text).toMatch(/The network rejected this transaction/);
        expect(text).not.toMatch(/txn-mempool-conflict/);
    });

    it('never says nothing was sent when the node may have taken it', async () => {
        const utils = await broadcastWith(() => Promise.reject(
            new Error('broadcast.signedTx: SDK did not return a txid'),
        ));
        const text = alertsText(utils);
        expect(text).toMatch(/Check your transaction history before broadcasting it again/);
        expect(text).not.toMatch(/SDK did not return|broadcast\.signedTx/);
        expect(text).not.toMatch(/nothing was (sent|broadcast)/i);
    });

    it('never promises the queued-transactions banner this route does not use', async () => {
        const err = new Error('socket hang up');
        err.name = 'BroadcastFailedTransientError';
        const utils = await broadcastWith(() => Promise.reject(err));
        const text = alertsText(utils);
        expect(text).toMatch(/Couldn't broadcast this transaction\./);
        expect(text).not.toMatch(/queued-transactions banner/);
    });

    it('names no shell API when this shell cannot broadcast', async () => {
        const utils = await broadcastWith(null);
        const text = alertsText(utils);
        expect(text).toMatch(/can't broadcast from here/i);
        expect(text).not.toMatch(/messaging\.|broadcastSignedTxRequest/);
    });
});

// The host reports whether the queue save landed as `persisted`; the banner
// promise is only true when it did.
describe('PSBT sign screen: a broadcast the host queued', () => {
    const queuedWith = (persisted) => broadcastWith(() => Promise.resolve({
        queued: true, broadcast: 'queued', queueId: 'q1', pendingTxId: 'p1', persisted,
    }));

    it('warns instead of promising the banner when the queue save was refused', async () => {
        const utils = await queuedWith(false);
        expect(alertsText(utils)).toMatch(/could not be saved to the queue/);
        expect(utils.container.textContent).not.toMatch(/saved in the\s+queued-transactions banner/);
        // The warning tells the user to copy the bytes, so the copy control must still be there.
        expect(utils.container.querySelector('[data-testid="signed-tx-hex"]')).toBeTruthy();
    });

    it('keeps the banner copy when the queue save landed', async () => {
        const utils = await queuedWith(true);
        expect(alertsText(utils)).not.toMatch(/could not be saved to the queue/);
        expect(utils.container.textContent).toMatch(/saved in the\s+queued-transactions banner/);
    });
});

describe('PSBT sign screen: auto-lock waits for the request in flight', () => {
    it('holds auto-lock while the hardware device signs', async () => {
        let finish;
        const utils = await mountAndPaste({
            signPsbtUserInitiatedHw: () => new Promise((resolve) => { finish = resolve; }),
        });
        await domAct(async () => {
            fireEvent.click(findButton(utils, /Sign on (Ledger|Trezor)|Sign transaction/i));
            await drainMicrotasks();
        });
        expect(isAutoLockHeld()).toBe(true);
        await domAct(async () => {
            finish({ signedPsbtHex: '', txHex: 'cc22', txid: 'dd33' });
            await drainMicrotasks();
        });
        expect(isAutoLockHeld()).toBe(false);
    });

    it('holds auto-lock while the signed transaction broadcasts', async () => {
        let fail;
        await broadcastWith(() => new Promise((_resolve, reject) => { fail = reject; }));
        expect(isAutoLockHeld()).toBe(true);
        await domAct(async () => {
            fail(new Error('node unreachable'));
            await drainMicrotasks();
        });
        expect(isAutoLockHeld()).toBe(false);
    });
});

describe('PSBT sign screen: a signing attempt that fails', () => {
    async function signWith(signPsbtUserInitiatedHw) {
        const utils = await mountAndPaste({ signPsbtUserInitiatedHw });
        const submitBtn = findButton(utils, /Sign on (Ledger|Trezor)|Sign transaction/i);
        await domAct(async () => {
            fireEvent.click(submitBtn);
            await drainMicrotasks();
        });
        return utils;
    }

    it('hides a handler precondition behind plain copy', async () => {
        const utils = await signWith(() => Promise.reject(new Error('psbt.signHw: addressId is required')));
        const text = utils.container.textContent;
        expect(text).toMatch(/Couldn't sign this transaction\./);
        expect(text).not.toMatch(/psbt\.signHw|addressId/);
    });

    it('keeps the wrong-password sentence', async () => {
        const err = new Error('decrypt failed');
        err.name = 'InvalidPasswordError';
        const utils = await signWith(() => Promise.reject(err));
        expect(utils.container.textContent).toMatch(/Incorrect password\./);
    });

    it('names no shell API when this shell cannot sign on a device', async () => {
        const utils = await mountAndPaste({ __absent: ['signPsbtUserInitiatedHw'] });
        const submitBtn = findButton(utils, /Sign on (Ledger|Trezor)|Sign transaction/i);
        await domAct(async () => {
            fireEvent.click(submitBtn);
            await drainMicrotasks();
        });
        const text = utils.container.textContent;
        expect(text).toMatch(/can't sign transactions on this screen/i);
        expect(text).not.toMatch(/messaging\.|signPsbtUserInitiated/);
    });
});
