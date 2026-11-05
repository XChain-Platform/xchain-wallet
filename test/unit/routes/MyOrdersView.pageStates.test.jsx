// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of a My orders cancel or edit lays out through a page template:
// the broadcast result, the unsigned result and the queued result each sit
// inside a FormPage form, like the cancel and edit form itself. None of them
// draws straight into the bare Screen.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';

const SOURCE_PATH = 'packages/core/src/shared/routes/MyOrdersView.jsx';
const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
    chainId: CHAIN, networkFeeSats: 1234,
});

const ROW = Object.freeze({
    action_index: '700', source: OWN,
    give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
    get_tick: 'OTHER', get_coin: 'DOGE', get_amount: '10', get_ownership: 0,
    expiration: FUTURE, block_index: '67882087', status: 'valid',
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

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

/** Mounts My orders with one open order; `signed` is what the cancel signer returns. */
async function mount({ signed = { txid: 'cancel-txid' }, settings = { walletMode: 'full' } } = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getListsForSource: () => Promise.resolve({ data: [] }),
        getListByActionIndex: () => Promise.resolve({ list: [] }),
        getOrdersForAddress: () => Promise.resolve({ data: [ROW] }),
        getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
        getOrderDetail: ({ actionIndex }) => Promise.resolve({
            action: 'ORDER', action_index: actionIndex, status: 'valid',
            state: { give_remaining: '500', get_remaining: '10', expiration: String(FUTURE), status: 'open' },
        }),
        listAutopayOrders: () => Promise.resolve([]),
        composeForConfirm: () => Promise.resolve({
            ...COMPOSED,
            decoded: {
                summary: 'Cancel order (#700)',
                details: [{ label: 'order action index', value: '700' }],
                warnings: [],
            },
        }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        cancelOrder: () => Promise.resolve(signed),
        buildActionPsbtRequest: () => Promise.resolve(signed),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
        has: (t, prop) => prop in t,
    });
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyOrdersView walletId="w" onBack={() => {}} onCreateOrder={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    return utils;
}

async function step(fn) {
    await domAct(async () => { fn(); await drain(); });
}

/** Opens the cancel for order #700 and signs it through the confirm page. */
async function cancelOrder(utils) {
    const row = within(utils.getByRole('list', { name: /^Open / })).getByText('#700', { exact: false }).closest('li');
    await step(() => fireEvent.click(within(row).getByRole('button', { name: 'Cancel' })));
    await step(() => fireEvent.click(utils.getByRole('button', { name: 'Cancel order' })));
    const approve = utils.container.querySelector('[data-testid="confirm-approve"]');
    expect(approve, 'the confirm page offers Approve').not.toBeNull();
    await step(() => fireEvent.click(approve));
}

function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

describe('My orders lays out every cancel and edit result through FormPage', () => {
    it('puts the broadcast result and its Done action inside the FormPage form', async () => {
        const utils = await mount();
        await cancelOrder(utils);
        const title = byText(utils.container, 'h2', 'Cancel broadcast');
        expect(title).not.toBeNull();
        const form = title.closest('form');
        expect(form).not.toBeNull();
        expect(form.textContent).toContain('cancel-txid');
        expect(byText(form, 'button', 'Done')).not.toBeNull();
    });

    it('renders the queued result screen inside a FormPage form', async () => {
        const utils = await mount({ signed: { queued: true } });
        await cancelOrder(utils);
        const notice = utils.container.querySelector('[data-testid="result-screen-notice"]');
        expect(notice).not.toBeNull();
        expect(notice.closest('form')).not.toBeNull();
    });

    it('renders the unsigned result screen inside a FormPage form', async () => {
        const utils = await mount({ settings: { walletMode: 'watcher' }, signed: { psbtHex: '70736274ff' } });
        const row = within(utils.getByRole('list', { name: /^Open / })).getByText('#700', { exact: false }).closest('li');
        await step(() => fireEvent.click(within(row).getByRole('button', { name: 'Cancel' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' })));
        const notice = utils.container.querySelector('[data-testid="result-screen-notice"]');
        expect(notice).not.toBeNull();
        expect(notice.closest('form')).not.toBeNull();
    });

    it('hands every cancel and edit Screen state to a page template in the source', () => {
        // The list view's own wrap() builds its ListPage itself; the action
        // panel's wrap() is a bare Screen, so each call names its template.
        const full = readFileSync(SOURCE_PATH, 'utf8');
        const source = full.slice(full.indexOf('function OrderActionPanel('));
        expect(source.length).toBeLessThan(full.length);
        const roots = [...source.matchAll(/\bwrap\(\s*<(\w*)/g)].map((match) => match[1]);
        expect(roots.length).toBeGreaterThan(0);
        expect(roots.filter((root) => root !== 'FormPage' && root !== 'ListPage')).toEqual([]);
    });
});
