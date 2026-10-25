// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An inbox key share that is signed but held in the broadcast queue ends on the queued
// panel and offers no second share, not on "Key shared".

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'owner-1',
    chainId: CHAIN,
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: null,
    role: 'receive',
});
const COUNTERPARTY = 'bc1qdevmock02ddeeff';
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: 'MESSAGE|0|BTC|bc1qdevmock02ddeeff|2|02aabbcc',
    version: 0,
    chainId: CHAIN,
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

async function drainMicrotasks(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function recordingMessaging(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [OWNER] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: OWNER }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        listContacts: () => Promise.resolve([]),
        getRecipientPubkey: () => Promise.resolve(null),
        getMessagingInboxSweep: () => Promise.resolve({
            messages: [{
                format: 0,
                chainId: CHAIN,
                from: COUNTERPARTY,
                to: OWNER.address,
                txid: 'request-tx',
                timestamp: 1,
            }],
            addresses: [],
            errors: [],
        }),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ ...COMPOSED });
        },
        preflight: (args) => {
            calls.push({ method: 'preflight', args });
            return Promise.resolve({ verdict: 'pass', findings: [], unverified: [] });
        },
        sendHandshake: (args) => {
            calls.push({ method: 'sendHandshake', args });
            return Promise.resolve({ txid: 'handshake-tx' });
        },
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(object, prop) {
            if (prop in object) return object[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({ ok: true });
            };
        },
    });
    return { messaging, calls };
}

function mount(Component, messaging, props = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Component, { walletId: 'wallet-1', onBack() {}, ...props }),
        ),
    );
}

async function approve(utils) {
    await domAct(async () => {
        const button = utils.getByTestId('confirm-approve');
        expect(button.disabled).toBe(false);
        fireEvent.click(button);
        await drainMicrotasks();
    });
}

describe('inbox key share with a signed-but-queued result', () => {
    it('ends on the queued panel and never offers a second share', async () => {
        const sendHandshake = vi.fn(() => Promise.reject(
            Object.assign(new Error('network down'), { name: 'BroadcastFailedTransientError' }),
        ));
        const { messaging } = recordingMessaging({ sendHandshake });
        let utils;
        await domAct(async () => {
            utils = mount(MessagingInbox, messaging);
            await drainMicrotasks(24);
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Share my key' }));
            await drainMicrotasks();
        });
        await approve(utils);

        expect(sendHandshake).toHaveBeenCalledTimes(1);
        expect(utils.queryByText(/Key shared/)).toBeNull();
        expect(utils.getByText('Signed. Not broadcast yet.')).toBeTruthy();
        expect(utils.queryByRole('button', { name: 'Share my key' })).toBeNull();

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Done' }));
            await drainMicrotasks();
        });
        expect(utils.queryByRole('button', { name: 'Share my key' })).toBeNull();
        expect(utils.queryByText(/Key shared/)).toBeNull();
        expect(utils.getByText(/Do not submit this again/)).toBeTruthy();
    });
});
