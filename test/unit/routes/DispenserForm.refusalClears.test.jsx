// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const REFUSAL = 'The network would refuse a dispenser at this address.';
const SOURCE = Object.freeze({
    id: 'source',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const FIRST = Object.freeze({
    id: 'first',
    address: 'bc1qfirstfirstfirstfirstfirstfirstfirstfirstf',
    source: 'hd',
    signerId: 'signer-1',
});
const SECOND = Object.freeze({
    id: 'second',
    address: 'bc1qsecondsecondsecondsecondsecondsecondseco',
    source: 'hd',
    signerId: 'signer-1',
});

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function messagingWithRefusal() {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [SOURCE, FIRST, SECOND] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: SOURCE }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        composeForConfirm: vi.fn().mockRejectedValue(new Error(REFUSAL)),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return () => Promise.resolve({ rows: [] });
        },
    });
}

async function pickAddress(utils, address) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Change dispenser address' }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: `View address ${address}` }));
        await drainMicrotasks();
    });
}

async function refuseCreate(utils) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));
        await drainMicrotasks();
    });
    expect(utils.getByText(/network would refuse a dispenser at this address/i)).toBeInTheDocument();
}

describe('DispenserForm stale address refusal', () => {
    it('clears formError when the existing address or address mode changes', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messagingWithRefusal()}>
                    <DispenserForm
                        walletId="wallet"
                        initialChainId={CHAIN}
                        initialTick="JDOG"
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );
            await drainMicrotasks();
        });

        await pickAddress(utils, FIRST.address);
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
            fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
            fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
            await drainMicrotasks();
        });

        await refuseCreate(utils);
        await pickAddress(utils, SECOND.address);
        expect(utils.queryByText(/network would refuse a dispenser at this address/i)).not.toBeInTheDocument();

        await refuseCreate(utils);
        await pickAddress(utils, SOURCE.address);
        expect(utils.queryByText(/network would refuse a dispenser at this address/i)).not.toBeInTheDocument();
    });
});
