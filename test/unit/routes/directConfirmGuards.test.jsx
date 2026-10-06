// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a form that calls confirmAction.confirm itself still gets both
// Approve-time guards. A PSBT older than the staleness window has its inputs
// re-checked before signing, spent inputs stop the signature, and a single
// token debit is reserved on the host-shared ledger.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';

// Past the hook's 30 s staleness window, so Approve runs the liveness probe.
const AGED_MS = 60_000;
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
});

async function drain(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function guardMessaging({ liveness = 'live' } = {}) {
    const calls = [];
    const record = (method, result) => (args) => {
        calls.push({ method, args });
        return Promise.resolve(result);
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ 'bitcoin-mainnet': [HD_ADDRESS] }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        composeForConfirm: record('composeForConfirm', {
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: 'ACT',
            version: 1,
            // One token debited, so the hook has a balance to reserve.
            simulation: { deltas: [{ tick: 'JDOG', before: '100', after: '90' }] },
        }),
        preflight: record('preflight', { verdict: 'pass', findings: [] }),
        checkInputLiveness: record('checkInputLiveness', { verdict: liveness, spent: [] }),
        reserve: record('reserve', {}),
        releaseReservation: record('releaseReservation', {}),
        mintToken: record('mintToken', { txid: 'tx-mint' }),
        destroyToken: record('destroyToken', { txid: 'tx-destroy' }),
    };
    const messaging = new Proxy(target, {
        get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve([])),
    });
    return { messaging, calls };
}

async function approveAged(Form, { actionLabel, confirm, liveness }) {
    const { messaging, calls } = guardMessaging({ liveness });
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Form walletId="w" onBack={() => {}} initialChainId="bitcoin-mainnet" initialTick="JDOG" />
            </MessagingProvider>,
        );
        await drain();
    });
    await act(async () => {
        fireEvent.change(utils.getByLabelText(/^Amount/), { target: { value: '10' } });
        await drain();
    });
    await act(async () => {
        fireEvent.click(utils.getByRole('button', { name: actionLabel }));
        await drain();
    });
    if (confirm) {
        const field = utils.queryByLabelText(/type .* to confirm/i);
        if (field) {
            await act(async () => {
                fireEvent.change(field, { target: { value: confirm } });
                await drain();
            });
        }
    }
    // Let the composed PSBT age past the staleness window before Approve.
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow + AGED_MS);
    await act(async () => {
        const approve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        if (!approve) throw new Error('no enabled Approve button in confirm modal');
        fireEvent.click(approve);
        await drain(20);
    });
    return calls;
}

const CASES = [
    { name: 'MintForm', Form: MintForm, actionLabel: 'Mint', submit: 'mintToken' },
    { name: 'DestroyForm', Form: DestroyForm, actionLabel: 'Destroy', confirm: 'DESTROY', submit: 'destroyToken' },
];

describe('direct confirm callers pass the Approve-time guards', () => {
    for (const c of CASES) {
        it(`${c.name} re-checks an aged PSBT's inputs and reserves the debit before signing`, async () => {
            const calls = await approveAged(c.Form, c);
            const probe = calls.find((x) => x.method === 'checkInputLiveness');
            expect(probe, 'liveness probe ran at Approve').toBeTruthy();
            expect(probe.args).toEqual({ chainId: 'bitcoin-mainnet', psbtHex: 'aa00' });
            const reserved = calls.find((x) => x.method === 'reserve');
            expect(reserved, 'the debit was reserved at Approve').toBeTruthy();
            expect(reserved.args).toMatchObject({ chainId: 'bitcoin-mainnet', tick: 'JDOG', amount: '10' });
            expect(calls.some((x) => x.method === c.submit)).toBe(true);
        });

        it(`${c.name} does not sign when the aged PSBT's inputs were spent`, async () => {
            const calls = await approveAged(c.Form, { ...c, liveness: 'spent' });
            expect(calls.some((x) => x.method === 'checkInputLiveness')).toBe(true);
            expect(calls.some((x) => x.method === c.submit)).toBe(false);
        });
    }
});
