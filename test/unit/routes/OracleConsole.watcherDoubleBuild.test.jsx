// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A watcher-mode resolve, cancel or list edit in the markets console builds
// one unsigned transaction per intent. Two taps while the first build is still
// in flight build one, and a Signer-mode wallet that signs the result pays one
// network fee.

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const now = () => Math.floor(Date.now() / 1000);

function feed(status) {
    return {
        action_index: '1193',
        source: OWN,
        label: 'Rain in the city on the deadline',
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        fee: '5',
        deadline: status === 'open' ? now() + 3600 : now() - 600,
        expire_at: now() + 3600,
        feed_status: status,
        chainId: CHAIN,
    };
}

function harness(status) {
    const calls = [];
    const pending = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betFeeds: ({ chainId }) => Promise.resolve({ data: chainId === CHAIN ? [feed(status)] : [] }),
        // The build stays in flight until the test releases it, so the second
        // tap lands while the first unsigned transaction is still being built.
        buildBetActionPsbtRequest: (args) => {
            calls.push(args);
            return new Promise((resolve) => {
                pending.push(() => resolve({
                    psbtHex: '70736274ff00', chainId: CHAIN, fromAddress: OWN, encoding: 'op_return',
                }));
            });
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, calls, release: () => pending.splice(0).forEach((fn) => fn()) };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(OracleConsole, { walletId: 'w', onBack() {} }),
        ));
        await drain();
    });
    return utils;
}

describe('OracleConsole watcher build under repeat taps', () => {
    it.each([
        ['Resolve', 'resolveMarketParams', 'closed', (utils) => fireEvent.click(utils.getByRole('button', { name: 'Yes' }))],
        ['Cancel and refund', 'cancelMarketParams', 'closed', null],
        ['Edit lists', 'editFeedListsParams', 'open', (utils) => fireEvent.change(
            utils.getByLabelText('New allow-list index'), { target: { value: '0' } },
        )],
    ])('%s builds one unsigned transaction for two taps in flight', async (action, builder, status, prepare) => {
        const { messaging, calls, release } = harness(status);
        const utils = await mount(messaging);
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: action }));
            await drain();
        });
        if (prepare) await domAct(async () => { prepare(utils); await drain(); });
        const build = utils.getByRole('button', { name: 'Create unsigned transaction' });
        await domAct(async () => {
            fireEvent.click(build);
            fireEvent.click(build);
            await drain();
        });
        await domAct(async () => {
            const again = utils.queryByRole('button', { name: 'Create unsigned transaction' });
            if (again) fireEvent.click(again);
            await drain();
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ builder, params: { feedActionIndex: '1193' } });
        await domAct(async () => { release(); await drain(); });
        expect(utils.getByLabelText('Unsigned transaction code')).toBeTruthy();
    });
});
