// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';
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
    resetWalletModes();
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

// `walletMode` among the overrides is the mode of wallet-1, published the way
// the shell does from the wallet list; every other override is a messaging method.
function recordingMessaging({ walletMode = 'full', ...overrides } = {}) {
    const calls = [];
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [OWNER] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: OWNER }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'wallet-1', name: 'W', walletMode }]),
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

describe('MESSAGE handshakes use shared confirmation', () => {
    it('confirms a compose key request before signing the exact PSBT', async () => {
        const { messaging, calls } = recordingMessaging();
        let utils;
        await domAct(async () => {
            utils = mount(ComposeMessage, messaging, { chainId: CHAIN });
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Address'), { target: { value: COUNTERPARTY } });
            fireEvent.change(utils.getByLabelText('Message'), { target: { value: 'hello' } });
            vi.advanceTimersByTime(500);
            await drainMicrotasks();
        });

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Request Encrypted Session (Publish Your Key)' }));
            await drainMicrotasks();
        });

        expect(utils.getByTestId('confirm-modal')).toBeTruthy();
        expect(utils.container.querySelector(`[title="${OWNER.address}"]`)).toBeTruthy();
        expect(calls.some((call) => call.method === 'preflight')).toBe(true);
        expect(calls.some((call) => call.method === 'sendHandshake')).toBe(false);

        await approve(utils);

        const submit = calls.find((call) => call.method === 'sendHandshake');
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(submit.args).toMatchObject({ destination: COUNTERPARTY, version: 0 });
    });

    it('confirms an inbox key-share reply before signing the exact PSBT', async () => {
        const { messaging, calls } = recordingMessaging();
        let utils;
        await domAct(async () => {
            utils = mount(MessagingInbox, messaging);
            await drainMicrotasks(24);
        });

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Share My Key' }));
            await drainMicrotasks();
        });

        expect(utils.getByTestId('confirm-modal')).toBeTruthy();
        expect(utils.container.querySelector(`[title="${OWNER.address}"]`)).toBeTruthy();
        expect(calls.some((call) => call.method === 'preflight')).toBe(true);
        expect(calls.some((call) => call.method === 'sendHandshake')).toBe(false);

        await approve(utils);

        const submit = calls.find((call) => call.method === 'sendHandshake');
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(submit.args).toMatchObject({ destination: COUNTERPARTY, version: 1 });
    });

    it('gives the inbox key-share confirmation the whole screen, then returns to the list', async () => {
        const { messaging } = recordingMessaging();
        let utils;
        await domAct(async () => {
            utils = mount(MessagingInbox, messaging);
            await drainMicrotasks(24);
        });
        expect(utils.getByRole('button', { name: 'Filter conversations' })).toBeTruthy();

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Share My Key' }));
            await drainMicrotasks();
        });

        // The review is its own screen: no inbox toolbar, request list or
        // inbox title sits around it.
        expect(utils.getByTestId('confirm-modal')).toBeTruthy();
        expect(utils.queryByRole('button', { name: 'Filter conversations' })).toBeNull();
        expect(utils.queryByRole('region', { name: 'Encrypted-session requests' })).toBeNull();
        expect(utils.queryByRole('heading', { name: 'Messaging' })).toBeNull();

        await approve(utils);

        expect(utils.queryByTestId('confirm-modal')).toBeNull();
        expect(utils.getByRole('button', { name: 'Filter conversations' })).toBeTruthy();
        expect(utils.getByText(/Key shared/)).toBeTruthy();
    });

    it('shows an unsigned inbox key-share without claiming it was sent in watcher mode', async () => {
        const buildActionPsbtRequest = vi.fn(() =>
            Promise.resolve({ psbtHex: 'aa00', encoding: 'psbt' }));
        const { messaging, calls } = recordingMessaging({
            walletMode: 'watcher',
            buildActionPsbtRequest,
        });
        let utils;
        await domAct(async () => {
            utils = mount(MessagingInbox, messaging);
            await drainMicrotasks(24);
        });

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Share My Key' }));
            await drainMicrotasks();
        });

        expect(utils.getByText('Unsigned transaction, ready for signing'))
            .toBeTruthy();
        expect(utils.getByLabelText('Unsigned transaction code').value).toBe('aa00');
        expect(utils.container.textContent).not.toMatch(/Key shared/i);
        expect(buildActionPsbtRequest).toHaveBeenCalledOnce();
        expect(calls.some((call) => call.method === 'sendHandshake')).toBe(false);
    });
});
