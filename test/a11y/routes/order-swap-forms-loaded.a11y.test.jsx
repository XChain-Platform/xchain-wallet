// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Edit Order, Cancel Order, Edit Swap and Cancel Swap with their item read:
// the Form Standard frame (From with Network, the main section, Speed and
// Fees, the action) scanned as the user sees it, not only its loading line.

import React from 'react';
import { act as domAct, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { EditOrderForm } from '../../../packages/core/src/shared/routes/EditOrderForm.jsx';
import { CancelOrderForm } from '../../../packages/core/src/shared/routes/CancelOrderForm.jsx';
import { EditSwapForm } from '../../../packages/core/src/shared/routes/EditSwapForm.jsx';
import { CancelSwapForm } from '../../../packages/core/src/shared/routes/CancelSwapForm.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function row(action) {
    return {
        action, action_index: action === 'SWAP' ? '812' : '700', source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
        state: { status: 'open', give_remaining: '500', expiration: String(FUTURE) },
    };
}

function messaging() {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getOrderDetail: () => Promise.resolve(row('ORDER')),
        getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
        listAutopayOrders: () => Promise.resolve([]),
        getSwapDetail: () => Promise.resolve({ data: row('SWAP') }),
        getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    return new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => new Promise(() => {}); },
    });
}

let savedGlobals;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    savedGlobals = { ResizeObserver: globalThis.ResizeObserver, matchMedia: globalThis.matchMedia };
    globalThis.ResizeObserver = StubObserver;
    globalThis.matchMedia = (query) => ({
        matches: false, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => cleanup());

afterAll(() => {
    globalThis.ResizeObserver = savedGlobals.ResizeObserver;
    globalThis.matchMedia = savedGlobals.matchMedia;
});

describe('order and swap Edit and Cancel forms, loaded', () => {
    it.each([
        ['EditOrderForm', EditOrderForm, '700'],
        ['CancelOrderForm', CancelOrderForm, '700'],
        ['EditSwapForm', EditSwapForm, '812'],
        ['CancelSwapForm', CancelSwapForm, '812'],
    ])('scans %s', async (_name, Component, actionIndex) => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messaging()}>
                    <Component walletId="w" chainId={CHAIN} actionIndex={actionIndex} onBack={() => {}} />
                </MessagingProvider>,
            );
            for (let i = 0; i < 40; i += 1) await Promise.resolve();
        });
        if (!utils.container.querySelector('[data-form-standard]')) throw new Error('the form did not load');
        await expectNoSeriousAxeViolations(utils.container);
    });
});
