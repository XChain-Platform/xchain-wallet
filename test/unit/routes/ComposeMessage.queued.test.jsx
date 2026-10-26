// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A message or key request that is signed but held in the broadcast queue ends on the
// queued panel, not on "Message sent" or "Key request sent", and offers no second send.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const flow = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({
            run: flow.run,
            open: false,
            composing: false,
            confirmAction: null,
        }),
        useConfirmSubmit: () => vi.fn(),
    };
});

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
const QUEUED = Object.freeze({ queued: true, broadcast: 'queued', unsaved: false });

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
    flow.run.mockReset();
    flow.run.mockResolvedValue(QUEUED);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

async function drain(rounds = 20) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function messagingFor(pubkey) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: OWNER }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecipientPubkey: vi.fn().mockResolvedValue(pubkey),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

async function openForm(pubkey) {
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messagingFor(pubkey)}>
                <ComposeMessage walletId="w" chainId={CHAIN} onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    await act(async () => {
        fireEvent.change(utils.getByLabelText('Address'), { target: { value: RECIPIENT } });
        fireEvent.change(utils.getByLabelText('Message'), { target: { value: 'hello there' } });
        await drain();
    });
    await act(async () => {
        vi.advanceTimersByTime(500);
        await drain();
    });
    return utils;
}

describe('ComposeMessage with a signed-but-queued result', () => {
    it('ends a queued message on the queued panel', async () => {
        const utils = await openForm('02' + 'ab'.repeat(32));
        await act(async () => {
            fireEvent.click(utils.getByRole('button', { name: /Send message/i }));
            await drain();
        });
        expect(flow.run).toHaveBeenCalledTimes(1);
        expect(utils.queryByText('Message sent')).toBeNull();
        expect(utils.getByText('Signed. Not broadcast yet.')).toBeTruthy();
        expect(utils.queryByRole('button', { name: /Send message/i })).toBeNull();
    });

    it('ends a queued key request on the queued panel with no second request', async () => {
        const utils = await openForm(null);
        await act(async () => {
            fireEvent.click(utils.getByRole('button', { name: /Request encrypted session/i }));
            await drain();
        });
        expect(flow.run).toHaveBeenCalledTimes(1);
        expect(utils.queryByText(/Key request sent/)).toBeNull();
        expect(utils.getByText('Signed. Not broadcast yet.')).toBeTruthy();
        expect(utils.queryByRole('button', { name: /Request encrypted session/i })).toBeNull();
    });
});
