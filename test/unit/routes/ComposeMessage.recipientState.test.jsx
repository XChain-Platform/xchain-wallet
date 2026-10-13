// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

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
const RECIPIENT_A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const RECIPIENT_B = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function messagingFor(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: OWNER }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecipientPubkey: vi.fn().mockResolvedValue('02' + 'ab'.repeat(32)),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function tree(messaging, props) {
    return React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ComposeMessage, {
            walletId: 'wallet-1',
            chainId: CHAIN,
            onBack() {},
            ...props,
        }),
    );
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('ComposeMessage recipient state', () => {
    it('starts a fresh draft when a mounted compose route is retargeted', async () => {
        const messaging = messagingFor();
        const utils = render(tree(messaging, {
            toAddress: RECIPIENT_A,
            initialMessage: 'prefill A',
            fixedEncryption: 'plaintext',
        }));

        expect(await screen.findByDisplayValue(RECIPIENT_A)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'private draft for A' } });

        utils.rerender(tree(messaging, {
            toAddress: RECIPIENT_B,
            initialMessage: 'prefill B',
            fixedEncryption: 'ecdh',
        }));

        expect(await screen.findByDisplayValue(RECIPIENT_B)).toBeTruthy();
        expect(screen.getByLabelText('Message').value).toBe('prefill B');
        expect(screen.queryByDisplayValue('private draft for A')).toBeNull();
        expect(screen.getByRole('button', { name: /Encryption: Shared key \(ECDH\)/ })).toBeDisabled();
    });

    it('handles a rejected lookup from the prior recipient after switching', async () => {
        vi.useFakeTimers();
        const lookupA = deferred();
        const lookupB = deferred();
        const messaging = messagingFor({
            getRecipientPubkey: vi.fn(({ address }) => (
                address === RECIPIENT_A ? lookupA.promise : lookupB.promise
            )),
        });
        const utils = render(tree(messaging, { toAddress: RECIPIENT_A }));

        await act(async () => {
            await Promise.resolve();
            vi.advanceTimersByTime(400);
            await Promise.resolve();
        });
        utils.rerender(tree(messaging, { toAddress: RECIPIENT_B }));
        await act(async () => {
            vi.advanceTimersByTime(400);
            await Promise.resolve();
            lookupB.resolve('02' + 'cd'.repeat(32));
            await Promise.resolve();
        });
        expect(screen.getByText(/Recipient public key found/)).toBeTruthy();

        await act(async () => {
            lookupA.reject(new Error('late lookup failure'));
            await Promise.resolve();
        });
        expect(screen.getByText(/Recipient public key found/)).toBeTruthy();
        expect(screen.queryByText(/can't encrypt/)).toBeNull();
    });
});
