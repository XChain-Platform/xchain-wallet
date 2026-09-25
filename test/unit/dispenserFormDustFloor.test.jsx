// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dispenser create form refuses a coin price under the chain's dust floor,
// rendered. Users on Dogecoin testnet opened dispensers at 0.00001985 DOGE per
// fill, which no buyer can pay for one fill at a time; the pure reading is
// pinned in flows/dispenserDustFloor.test.js, and this file pins that the form
// actually shows it, refuses Create on it, and that the one-click bundle fix
// rewrites the fields into a dispenser that composes.
//
// Bitcoin here (the harness chain the confirm suite uses), so the floor is 546
// sats: 100 sats per fill needs 6 fills, 0.000006 BTC.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN = 'bitcoin-mainnet';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

function recordingMessaging() {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
        },
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({ rows: [] });
            };
        },
    });
    return { messaging, calls };
}

async function flush(step) {
    await domAct(async () => {
        if (step) step();
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

async function mountFilled(price) {
    const { messaging, calls } = recordingMessaging();
    let utils;
    await flush(() => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(DispenserForm, {
                walletId: 'w', onBack() {}, initialChainId: CHAIN, initialTick: 'JDOG',
            })));
    });
    const set = (label, value) => fireEvent.change(utils.getByLabelText(label), { target: { value } });
    await flush(() => {
        set(/^Give amount/, '10');
        set(/^Escrow amount/, '100');
        set(/^Trigger price/, price);
    });
    return { utils, calls, set };
}

const composed = (calls) => calls.filter((c) => c.method === 'composeForConfirm');

describe('DispenserForm dust-floor guard', () => {

    it('shows the refusal under the price and will not compose on Create', async () => {
        const { utils, calls } = await mountFilled('0.000001');
        expect(utils.container.textContent).toContain('nobody can buy a single fill');
        expect(utils.container.textContent).toContain('6 fills (0.000006 BTC)');
        await flush(() => fireEvent.click(utils.getByRole('button', { name: 'Create' })));
        expect(composed(calls)).toHaveLength(0);
        expect(utils.container.textContent).toContain('below the smallest payment buyers can send');
    });

    it('rewrites the fields to the bundle on one click, and that dispenser composes', async () => {
        const { utils, calls } = await mountFilled('0.000001');
        await flush(() => fireEvent.click(utils.getByRole('button', { name: 'Sell 60 per fill at 0.000006 BTC' })));
        expect(utils.getByLabelText(/^Give amount/).value).toBe('60');
        expect(utils.getByLabelText(/^Trigger price/).value).toBe('0.000006');
        expect(utils.container.textContent).not.toContain('nobody can buy a single fill');
        await flush(() => fireEvent.click(utils.getByRole('button', { name: 'Create' })));
        expect(composed(calls)).toHaveLength(1);
        expect(composed(calls)[0].args.actionData.params)
            .toMatchObject({ GIVE_AMOUNT: '60', GET_AMOUNT: '0.000006' });
    });

    it('retracts the Create refusal once the price is raised by hand', async () => {
        const { utils, set } = await mountFilled('0.000001');
        await flush(() => fireEvent.click(utils.getByRole('button', { name: 'Create' })));
        expect(utils.container.textContent).toContain('below the smallest payment buyers can send');
        await flush(() => set(/^Trigger price/, '0.001'));
        expect(utils.container.textContent).not.toContain('below the smallest payment buyers can send');
        expect(utils.container.textContent).not.toContain('nobody can buy a single fill');
    });

});
