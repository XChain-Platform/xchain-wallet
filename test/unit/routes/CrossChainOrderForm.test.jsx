// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CrossChainOrderForm: the ORDER surface whose GIVE_COIN and GET_COIN
// differ. The order is signed on the give chain, the GET_ADDRESS names the
// wallet's own address on the get chain, and the whole thing rides the
// same single-encode confirm lane as CreateOrderForm.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { CrossChainOrderForm } from '../../../packages/core/src/shared/routes/CrossChainOrderForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import * as walletModes from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';

const DOGE_ADDRESS = Object.freeze({
    id: 'addr-doge-0',
    address: 'Ddevmock02aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const BTC_ADDRESS = Object.freeze({
    id: 'addr-btc-0',
    address: 'bc1qdevmock02ddeeff',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
});

beforeEach(() => {
    __clearTokenInfoCache();
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
    vi.restoreAllMocks();
    vi.useRealTimers();
    // The Quick | Full choice is remembered; every test starts on Quick.
    globalThis.localStorage?.clear();
    walletModes.resetWalletModes?.();
});

// A wallet's mode is published by the shell from the wallet list, not read
// from settings; the harness publishes the mode the settings mock names.
async function publishMode(overrides) {
    const settings = await overrides.getSettings?.();
    walletModes.publishWalletModes?.({
        wallets: [{ id: 'w', walletMode: settings?.walletMode || 'full' }],
        activeWalletId: 'w',
    });
}

// Recording messaging mock: a wallet with one address on DOGE and one on
// BTC, whose newest address on any chain is that chain's only address.
function recordingMessaging(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getNewestAddress: (walletId, chainId) => {
            calls.push({ method: 'getNewestAddress', args: { walletId, chainId } });
            return Promise.resolve(chainId === BTC ? BTC_ADDRESS : DOGE_ADDRESS);
        },
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({
            [DOGE]: [{
                address: DOGE_ADDRESS.address,
                balances: {
                    tokens: [
                        { tick: 'JDOG', displayName: 'JDOG', quantity: '1000', divisibility: 0 },
                        { tick: 'OTHER', displayName: 'OTHER', quantity: '100000000', divisibility: 8 },
                    ],
                },
            }],
        }),
        getTokenInfo: ({ tick }) => Promise.resolve({ divisibility: tick === 'JDOG' ? 0 : 8 }),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ ...COMPOSED });
        },
        preflight: (args) => {
            calls.push({ method: 'preflight', args });
            return Promise.resolve({ verdict: 'pass', findings: [] });
        },
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({ txid: `tx-${String(prop)}`, rows: [] });
            };
        },
    });
    return { messaging, calls };
}

// A wallet with addresses on DOGE, BTC and LTC, each holding a token the
// pickers can offer; the newest address on a chain names that chain.
function multiChainOverrides() {
    const ltcAddress = { ...BTC_ADDRESS, id: 'addr-ltc-0', address: 'ltc1qexample' };
    return {
        getAddressesByChain: () => Promise.resolve({ [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS], 'litecoin-mainnet': [ltcAddress] }),
        getNewestAddress: (walletId, chainId) => Promise.resolve({ address: `newest-on-${chainId}` }),
        getWalletBalances: () => Promise.resolve({
            [DOGE]: [{
                address: DOGE_ADDRESS.address,
                balances: {
                    tokens: [
                        { tick: 'JDOG', displayName: 'JDOG', quantity: '1000', divisibility: 0 },
                        { tick: 'OTHER', displayName: 'OTHER', quantity: '100000000', divisibility: 8 },
                    ],
                },
            }],
            [BTC]: [{ address: BTC_ADDRESS.address, balances: { tokens: [{ tick: 'BTCTOK', quantity: '5', divisibility: 0 }] } }],
            'litecoin-mainnet': [{ address: ltcAddress.address, balances: { tokens: [{ tick: 'LTCTOK', quantity: '5', divisibility: 0 }] } }],
        }),
    };
}

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(props = {}, overrides = {}) {
    const { messaging, calls } = recordingMessaging(overrides);
    await publishMode(overrides);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(CrossChainOrderForm, { walletId: 'w', onBack() {}, ...props }),
            ),
        );
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function mountCreate(props = {}, overrides = {}) {
    const { messaging, calls } = recordingMessaging(overrides);
    await publishMode(overrides);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(CreateOrderForm, {
                    walletId: 'w',
                    onBack() {},
                    initialChainId: DOGE,
                    ...props,
                }),
            ),
        );
        await drainMicrotasks();
    });
    return { utils, calls };
}

const setValue = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

// A token or network field is a trigger button named "<label>: <selection>".
const pickerName = (utils, label) => utils.getByRole('button', { name: new RegExp(`^${label}:`) })
    .getAttribute('aria-label');

// Expiration is the icon dropdown (G44): open it, then pick the custom time,
// each in its own act so the listbox renders before its option is clicked.
async function pickCustomExpiry(utils) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('combobox', { name: /^Expiration/, hidden: true }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('option', { name: 'Expire at a specific time', hidden: true }));
        await drainMicrotasks();
    });
}

// Closed sections keep their fields mounted but hidden; open one by its id
// (from, order, options, ...) before querying its controls by role.
async function openSection(utils, id) {
    const toggle = utils.container.querySelector(`[data-form-section="${id}"] [data-form-section-toggle]`);
    if (toggle.getAttribute('aria-expanded') === 'true') return;
    await domAct(async () => {
        fireEvent.click(toggle);
        await drainMicrotasks();
    });
}

// Receive at is typed in the Full view; Quick shows it as a read-only row.
async function showFull(utils) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('radio', { name: 'Full' }));
        await drainMicrotasks();
    });
}

// The get network follows the picked get token. A token held on another
// network is a row in the Get token picker; picking it moves the get network.
async function pickGetTokenFromList(utils, tick) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: /^Get token:/ }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: new RegExp(`^Select ${tick}(?: on |$)`) }));
        await drainMicrotasks();
    });
}

// A ticker or ^ID the list does not hold is typed into the picker's search
// and taken with "Use typed name"; it is used on the current get network.
async function pickGetToken(utils, tick) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: /^Get token:/ }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Filter coins and tokens' }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.change(utils.getAllByLabelText('Search coins or tokens')[0], { target: { value: tick } });
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Use Typed Name' }));
        await drainMicrotasks();
    });
}

async function pickGiveToken(utils, tick) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: /^Give token:/ }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: new RegExp(`^Select ${tick}(?: on |$)`) }));
        await drainMicrotasks();
    });
}

async function fillPair(utils) {
    await pickGiveToken(utils, 'JDOG');
    await domAct(async () => {
        setValue(utils, /^Give amount/, '10');
        await drainMicrotasks();
    });
    // Picking a get token clears the get amount, so it is typed after.
    await pickGetToken(utils, 'XCHAIN');
    await domAct(async () => {
        setValue(utils, /^Get amount/, '20');
        await drainMicrotasks();
    });
}

async function placeAndApprove(utils) {
    const button = utils.getByRole('button', { name: 'Place Order' });
    expect(button.disabled, '"Place Order" button is enabled').toBe(false);
    await domAct(async () => {
        fireEvent.click(button);
        await drainMicrotasks();
    });
    await domAct(async () => {
        const approve = utils.getAllByRole('button', { name: /approve/i })
            .find((button) => !button.disabled);
        if (!approve) throw new Error('no enabled Approve button on the confirm page');
        fireEvent.click(approve);
        await drainMicrotasks();
    });
}

describe('CrossChainOrderForm', () => {
    // U18: the page is titled Cross-Chain Order, so its main section is titled
    // Order, as Create Order's is, rather than repeating the page title.
    it('titles the main section Order, not the page title again', async () => {
        const { utils } = await mount({ initialChainId: DOGE });
        expect(utils.container.querySelector('[data-form-section="order"] [data-form-section-title]')).toHaveTextContent(/^Order$/);
    });

    it('uses field help, memo label state, and no standalone order-fill disclosure', async () => {
        const { utils } = await mount({ initialChainId: DOGE });
        // Full shows every field; From and Order Terms are closed sections.
        await showFull(utils);
        await openSection(utils, 'from');
        await openSection(utils, 'options');
        await openSection(utils, 'memo');

        for (const label of [
            'From address',
            'Give token',
            'Give amount',
            'Get token',
            'Get amount',
            'Expiration',
            'Expires',
        ]) {
            expect(utils.getByRole('button', { name: `About ${label}` })).toBeTruthy();
        }
        // Memo is its own section with no label row or tip (operator 2026-11-13).
        expect(utils.queryByRole('button', { name: 'About Memo' })).toBeNull();
        expect(utils.getByRole('textbox', { name: 'Memo' })).toHaveAttribute('id', 'xorder-memo');
        // Expires always shows, set by the 3 months default.
        expect(utils.getByLabelText('Expires').value).not.toBe('');
        expect(utils.queryByText('How orders fill')).toBeNull();
        expect(utils.container.querySelector('details')).toBeNull();
        // The Ownership, Order Terms, Memo and Advanced section header tags
        // (Ownership shows in both input styles, operator 2026-11-13).
        expect(utils.getAllByText('Optional')).toHaveLength(4);
        // The memo count sits in the open Memo section's header.
        expect(utils.getByText('0 / 250')).toBeTruthy();
        expect(utils.container.textContent).not.toContain('(optional)');
    });

    it('lists only token holdings from the selected source address on the give chain', async () => {
        const otherAddress = { ...DOGE_ADDRESS, id: 'addr-doge-1', address: 'Dothermock02aabbcc' };
        const { utils } = await mount({ initialChainId: DOGE }, {
            getWalletBalances: () => Promise.resolve({
                [DOGE]: [
                    {
                        address: DOGE_ADDRESS.address,
                        balances: { tokens: [{ tick: 'JDOG', quantity: '5', divisibility: 0 }] },
                    },
                    {
                        address: otherAddress.address,
                        balances: { tokens: [{ tick: 'HIDDEN', quantity: '9', divisibility: 0 }] },
                    },
                ],
                [BTC]: [{
                    address: BTC_ADDRESS.address,
                    balances: { tokens: [{ tick: 'WRONGCHAIN', quantity: '7', divisibility: 0 }] },
                }],
            }),
        });

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /^Give token:/ }));
            await drainMicrotasks();
        });

        expect(utils.getByRole('button', { name: /^Select JDOG(?: on |$)/ })).toBeTruthy();
        expect(utils.queryByRole('button', { name: /^Select HIDDEN(?: on |$)/ })).toBeNull();
        // The give picker lists every network now (a pick moves the give
        // network), so a token held on Bitcoin is offered, named for its network.
        expect(utils.getByRole('button', { name: /^Select WRONGCHAIN on Bitcoin/ })).toBeTruthy();
        expect(utils.queryByRole('button', { name: /^Select Dogecoin(?: on |$)/ })).toBeNull();
    });

    it('uses one named green icon action in both form branches and on watcher review', async () => {
        const full = await mount({ initialChainId: DOGE });
        const fullAction = full.utils.getByRole('button', { name: 'Place Order' });
        expect(fullAction).toHaveClass(buttonStyles.success);
        expect(fullAction.querySelector('svg')).toBeTruthy();
        expect(full.utils.container.querySelectorAll(`.${buttonStyles.success}`)).toHaveLength(1);
        expect(full.utils.queryByRole('button', { name: 'Preview' })).toBeNull();
        full.utils.unmount();

        const watcher = await mount({ initialChainId: DOGE }, {
            getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        });
        const watcherAction = watcher.utils.getByRole('button', { name: 'Place Order' });
        expect(watcherAction).toHaveClass(buttonStyles.success);
        expect(watcherAction.querySelector('svg')).toBeTruthy();
        expect(watcher.utils.container.querySelectorAll(`.${buttonStyles.success}`)).toHaveLength(1);
        expect(watcher.utils.queryByRole('button', { name: 'Preview' })).toBeNull();

        await fillPair(watcher.utils);
        await domAct(async () => {
            fireEvent.click(watcher.utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });
        const reviewAction = watcher.utils.getByRole('button', { name: 'Approve' });
        expect(reviewAction).toHaveClass(buttonStyles.success);
        expect(reviewAction.querySelector('svg')).toBeTruthy();
        expect(watcher.utils.getByRole('button', { name: 'Reject' }).querySelector('svg')).toBeTruthy();
        expect(watcher.utils.container.querySelectorAll(`.${buttonStyles.success}`)).toHaveLength(1);
    });

    it('gives on DOGE, gets on BTC, and names the wallet\'s BTC address as GET_ADDRESS', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        // The get chain defaulted to the other coin, and the receiver was
        // resolved on THAT chain, not on the chain being signed.
        // The give network is the From section's Network; the get network has
        // no field of its own (the get token sets it), so it shows as the
        // receiver resolved on Bitcoin.
        await openSection(utils, 'from');
        expect(pickerName(utils, 'Network')).toBe('Network: Dogecoin');
        await showFull(utils);
        expect(utils.getByLabelText('Receive at').value).toBe(BTC_ADDRESS.address);
        expect(calls.filter((c) => c.method === 'getNewestAddress').map((c) => c.args.chainId)).toEqual([BTC]);
        expect(utils.queryByText('How orders fill')).toBeNull();
        expect(utils.container.textContent).not.toMatch(/federation|price-time/i);

        await fillPair(utils);
        await placeAndApprove(utils);
        expect(utils.container.textContent).toContain('Cross-chain order broadcast');
        expect(utils.container.textContent).toMatch(/The network\s+matches this order automatically/);
        expect(utils.container.textContent).not.toMatch(/federation|price-time/i);

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose, 'composeForConfirm was dispatched').toBeTruthy();
        expect(compose.args.chainId).toBe(DOGE);
        expect(compose.args.actionData.action).toBe('ORDER');
        expect(compose.args.actionData.params).toMatchObject({
            VERSION: '0',
            GIVE_COIN: 'DOGE', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10',
            GET_COIN: 'BTC', GET_TICK: 'XCHAIN', GET_AMOUNT: '20',
            GET_ADDRESS: BTC_ADDRESS.address,
        });
        expect(compose.args.actionData.params.GIVE_COIN).not.toBe(compose.args.actionData.params.GET_COIN);
        expect(calls.some((c) => c.method === 'preflight'), 'preflight streamed').toBe(true);

        // Approve signs on the GIVE chain through orderAction, with the
        // previewed PSBT and the same cross-chain params.
        const submit = calls.find((c) => c.method === 'orderAction');
        expect(submit, 'orderAction was dispatched on Approve').toBeTruthy();
        expect(submit.args.chainId).toBe(DOGE);
        expect(submit.args.from.address).toBe(DOGE_ADDRESS.address);
        expect(submit.args.params).toMatchObject({ GIVE_COIN: 'DOGE', GET_COIN: 'BTC', GET_ADDRESS: BTC_ADDRESS.address });
        expect(submit.args.params).toEqual(compose.args.actionData.params);
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(calls.some((c) => c.method === 'swapAction')).toBe(false);
    });

    it('re-resolves the receiver when the get network changes, and keeps a typed one', async () => {
        const { utils } = await mount({ initialChainId: DOGE }, multiChainOverrides());
        await showFull(utils);
        expect(utils.getByLabelText('Receive at').value).toBe(`newest-on-${BTC}`);
        // Typed override survives; a chain switch re-arms the default.
        await domAct(async () => {
            setValue(utils, 'Receive at', 'typed-by-user');
            await drainMicrotasks();
        });
        expect(utils.getByLabelText('Receive at').value).toBe('typed-by-user');
        // Picking a get token held on Litecoin moves the get network.
        await pickGetTokenFromList(utils, 'LTCTOK');
        expect(pickerName(utils, 'Get token')).toBe('Get token: LTCTOK on Litecoin');
        expect(utils.getByLabelText('Receive at').value).toBe('newest-on-litecoin-mainnet');
    });

    it('reformats the give amount when its token changes and clears assets when a network changes', async () => {
        const { utils } = await mount({ initialChainId: DOGE }, multiChainOverrides());
        // The amount fields format to the token's divisibility in the Full view.
        await showFull(utils);
        await fillPair(utils);

        await pickGiveToken(utils, 'OTHER');
        await pickGetToken(utils, 'WANTED');
        expect(pickerName(utils, 'Give token')).toBe('Give token: OTHER on Dogecoin');
        expect(utils.getByLabelText(/^Give amount/).value).toBe('10');
        expect(utils.getByLabelText(/^Get amount/).value).toBe('');

        await pickGiveToken(utils, 'JDOG');
        await domAct(async () => {
            setValue(utils, /^Give amount/, '10');
            await drainMicrotasks();
        });
        await pickGetToken(utils, 'XCHAIN');
        await domAct(async () => {
            setValue(utils, /^Get amount/, '20');
            await drainMicrotasks();
        });
        // A get token on another network moves the get network and clears the get side.
        await pickGetTokenFromList(utils, 'LTCTOK');
        expect(pickerName(utils, 'Get token')).toBe('Get token: LTCTOK on Litecoin');
        expect(utils.getByLabelText(/^Get amount/).value).toBe('');
        expect(pickerName(utils, 'Give token')).toBe('Give token: JDOG on Dogecoin');
        expect(utils.getByLabelText(/^Give amount/).value).toBe('10');

        // A give token on another network moves the give network and clears the give side.
        await pickGiveToken(utils, 'BTCTOK');
        expect(pickerName(utils, 'Give token')).toBe('Give token: BTCTOK on Bitcoin');
        expect(utils.getByLabelText(/^Give amount/).value).toBe('');
    });

    it('dispatches only one watcher build when two submit events arrive in one render', async () => {
        let builds = 0;
        let finishBuild;
        const pending = new Promise((resolve) => { finishBuild = resolve; });
        const { utils } = await mount({ initialChainId: DOGE }, {
            getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
            buildActionPsbtRequest: () => {
                builds += 1;
                return pending;
            },
        });
        await fillPair(utils);
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });

        const approve = utils.getByRole('button', { name: 'Approve' });
        await domAct(async () => {
            fireEvent.click(approve);
            fireEvent.click(approve);
            await drainMicrotasks();
        });
        expect(builds).toBe(1);
        await domAct(async () => {
            finishBuild({ psbtHex: 'unsigned-cross-chain' });
            await drainMicrotasks();
        });
    });

    it('locks the order fields while the review composes, so the terms cannot change under it', async () => {
        let rejectCompose;
        const pending = new Promise((resolve, reject) => { rejectCompose = reject; });
        const { utils } = await mount({ initialChainId: DOGE }, { composeForConfirm: () => pending });
        await fillPair(utils);
        const form = utils.getByRole('button', { name: 'Place Order' }).closest('form');
        await domAct(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await drainMicrotasks();
        });
        expect(form).toHaveAttribute('inert');
        expect(form).toHaveAttribute('aria-busy', 'true');

        await domAct(async () => {
            rejectCompose(Object.assign(new Error('cancelled'), { reason: 'user-rejected' }));
            await drainMicrotasks();
        });
        expect(utils.getByRole('button', { name: 'Place Order' }).closest('form')).not.toHaveAttribute('inert');
    });

    it('ignores a duplicate full-wallet submit while compose is pending', async () => {
        let composes = 0;
        let rejectCompose;
        const pending = new Promise((resolve, reject) => { rejectCompose = reject; });
        const { utils } = await mount({ initialChainId: DOGE }, {
            composeForConfirm: () => {
                composes += 1;
                return pending;
            },
        });
        await fillPair(utils);
        const form = utils.getByRole('button', { name: 'Place Order' }).closest('form');
        await domAct(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await drainMicrotasks();
        });
        expect(composes).toBe(1);
        expect(utils.container.textContent).not.toMatch(/confirmation is already in progress/i);

        await domAct(async () => {
            rejectCompose(Object.assign(new Error('cancelled'), { reason: 'user-rejected' }));
            await drainMicrotasks();
        });
    });

    it('refuses a same-coin pair and points at Create order', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        // A get token held on Dogecoin moves the get network to the give network.
        await pickGetTokenFromList(utils, 'OTHER');
        await fillPair(utils);
        const place = utils.getByRole('button', { name: 'Place Order' });
        expect(place).toBeEnabled();
        fireEvent.click(place);
        expect(utils.getByLabelText('Form errors')).toHaveTextContent(/Give and get networks must differ/);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('refuses a native coin on the requested side', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await pickGetToken(utils, 'BTC');
        expect(utils.container.textContent).not.toMatch(/escrowed for the federation/);
        const place = utils.getByRole('button', { name: 'Place Order' });
        expect(place).toBeEnabled();
        fireEvent.click(place);
        expect(utils.getByLabelText('Form errors')).toHaveTextContent(/cannot get native BTC/);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('will not compose without a receive address on the get network', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE }, {
            getNewestAddress: () => Promise.resolve(null),
        });
        await fillPair(utils);
        await showFull(utils);
        expect(utils.getByLabelText('Receive at').value).toBe('');
        expect(utils.getByRole('button', { name: 'Place Order' })).toBeEnabled();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });
        expect(utils.getByLabelText('Form errors')).toHaveTextContent(/Receive address on .* is required/);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('validates token precision and the exact give balance before compose', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE }, {
            getTokenInfo: ({ tick }) => Promise.resolve({ divisibility: tick === 'JDOG' ? 0 : 8 }),
            getWalletBalances: () => Promise.resolve({
                [DOGE]: [{
                    address: DOGE_ADDRESS.address,
                    balances: { tokens: [{ tick: 'JDOG', quantity: '5', divisibility: 0 }] },
                }],
            }),
        });
        // Full shows each amount field's own precision message.
        await showFull(utils);
        await fillPair(utils);
        await domAct(async () => {
            vi.advanceTimersByTime(450);
            await drainMicrotasks();
        });

        await domAct(async () => {
            setValue(utils, /^Give amount/, '1.5');
            await drainMicrotasks();
        });
        expect(utils.getByText('Amount can have at most 0 decimal places.')).toBeTruthy();

        await domAct(async () => {
            setValue(utils, /^Give amount/, '6');
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });
        expect(utils.getByLabelText('Form errors')).toHaveTextContent('Give amount is above your available JDOG balance.');
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('blocks malformed token IDs, recipients, and empty custom expiry before compose', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await fillPair(utils);

        await pickGetToken(utils, '^0');
        fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
        expect(utils.getByLabelText('Form errors')).toHaveTextContent("Get token can be a name, or ^ followed by the token's number (^123).");

        // Receive at is typed in the Full view; picking a get token clears its amount.
        await pickGetToken(utils, 'XCHAIN');
        await showFull(utils);
        await domAct(async () => {
            setValue(utils, /^Give amount/, '10');
            setValue(utils, /^Get amount/, '20');
            setValue(utils, 'Receive at', 'not an address');
            await drainMicrotasks();
        });
        expect(utils.container.textContent).toContain('This is not a valid address.');

        await pickCustomExpiry(utils);
        // The specific time starts from the Expires shown; clearing it is the empty expiry.
        expect(utils.getByLabelText('Expires').value).not.toBe('');
        await domAct(async () => {
            setValue(utils, 'Expires', '');
            setValue(utils, 'Receive at', BTC_ADDRESS.address);
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });
        expect(utils.container.textContent).toContain('Pick an expiration date and time, or choose a common term.');
        // The refused review reopens Order Terms, the section holding the expiry.
        expect(utils.container.querySelector('[data-form-section="options"] [data-form-section-toggle]'))
            .toHaveAttribute('aria-expanded', 'true');
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('watcher review matches built normalized values and Back keeps the form values', async () => {
        const onBack = vi.fn();
        const { utils } = await mount({ initialChainId: DOGE, onBack }, {
            getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        });
        await fillPair(utils);
        await showFull(utils);
        await domAct(async () => {
            setValue(utils, 'Receive at', `  ${BTC_ADDRESS.address}  `);
            setValue(utils, 'Memo', '  exact memo  ');
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });

        expect(utils.getByText(/Another phone signs for this wallet: this prepares the transaction for it/)).toBeTruthy();
        expect(utils.getByTestId('confirm-modal')).toHaveAccessibleName(/20 XCHAIN for 10 JDOG/);
        expect(utils.getByTestId('confirm-sentence')).toHaveTextContent('20 XCHAIN');
        expect(utils.getByTitle(BTC_ADDRESS.address)).toBeTruthy();
        expect(utils.getByText('exact memo')).toBeTruthy();
        expect(utils.getByTestId('confirm-facts')).toBeTruthy();
        expect(utils.queryByText('Estimate unavailable')).toBeNull();
        expect(utils.getByRole('button', { name: 'Reject' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Approve' })).toBeTruthy();

        fireEvent.click(utils.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(utils.getByLabelText(/^Give amount/).value).toBe('10');
        expect(utils.getByLabelText(/^Get amount/).value).toBe('20');
        expect(utils.getByLabelText('Receive at').value).toBe(`  ${BTC_ADDRESS.address}  `);
        expect(utils.getByLabelText('Memo').value).toBe('  exact memo  ');
    });

    it('refuses a custom expiration that passes while editing but expires on watcher review', async () => {
        const buildActionPsbtRequest = vi.fn();
        const { utils } = await mount({ initialChainId: DOGE }, {
            getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
            buildActionPsbtRequest,
        });
        await fillPair(utils);
        const start = Date.now();
        const expiration = new Date(start + 60_000);
        const localExpiration = new Date(expiration.getTime() - expiration.getTimezoneOffset() * 60_000)
            .toISOString().slice(0, 16);
        await pickCustomExpiry(utils);
        await domAct(async () => {
            setValue(utils, 'Expires', localExpiration);
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });
        expect(utils.getByRole('button', { name: 'Approve' })).toBeTruthy();

        vi.spyOn(Date, 'now').mockReturnValue(start + 120_000);
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Approve' }));
            await drainMicrotasks();
        });

        expect(utils.getAllByText('Expiration must be a future date and time.')).toHaveLength(2);
        expect(utils.getByLabelText(/^Give amount/).value).toBe('10');
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a custom expiration that expires on the full-wallet confirmation', async () => {
        const start = Date.now();
        const expiration = new Date(start + 60_000);
        const localExpiration = new Date(expiration.getTime() - expiration.getTimezoneOffset() * 60_000)
            .toISOString().slice(0, 16);
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await fillPair(utils);
        await pickCustomExpiry(utils);
        await domAct(async () => {
            setValue(utils, 'Expires', localExpiration);
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });

        vi.spyOn(Date, 'now').mockReturnValue(start + 120_000);
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drainMicrotasks();
        });

        expect(utils.getByText('Expiration must be a future date and time.')).toBeTruthy();
        expect(calls.some((call) => call.method === 'orderAction')).toBe(false);
    });

    it('shows encoder failures as plain copy on the form', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const encoderError = Object.assign(
            new Error('no spendable UTXOs found for the funding address'),
            { name: 'SDKEncoderError', code: 'NO_UTXOS' },
        );
        const { utils } = await mount({ initialChainId: DOGE }, {
            composeForConfirm: () => Promise.reject(encoderError),
        });
        await fillPair(utils);
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });

        expect(utils.container.textContent).toMatch(/needs DOGE for the protocol fee and the network fee/i);
        expect(utils.container.textContent).not.toMatch(/UTXO/i);
    });

    it('explains itself on a wallet with addresses on one network only', async () => {
        const { utils } = await mount({}, {
            getAddressesByChain: () => Promise.resolve({ [DOGE]: [DOGE_ADDRESS] }),
        });
        expect(utils.container.textContent).toMatch(/addresses on two different networks/);
        expect(utils.queryByRole('button', { name: 'Place Order' })).toBeNull();
    });

    // The Get token picker offers Create order's "Use typed name", so a ^ID
    // reference the list does not hold reaches GET_TICK as typed.
    it('takes a typed ^ID as the Get token and composes it into GET_TICK', async () => {
        globalThis.localStorage?.setItem('xc.giveGet.view.crossChainOrder', 'quick');
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await pickGiveToken(utils, 'JDOG');
        await domAct(async () => {
            setValue(utils, /^Give amount/, '10');
            fireEvent.click(utils.getByRole('button', { name: /^Get token:/ }));
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Filter coins and tokens' }));
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.change(utils.getAllByLabelText('Search coins or tokens')[0], { target: { value: '^123' } });
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Use Typed Name' }));
            await drainMicrotasks();
        });
        expect(utils.getByRole('button', { name: /^Get token: \^123/ })).toBeTruthy();
        await domAct(async () => {
            setValue(utils, /^Get amount/, '20');
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose, 'composeForConfirm was dispatched').toBeTruthy();
        expect(compose.args.actionData.params).toMatchObject({
            GIVE_COIN: 'DOGE', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10',
            GET_COIN: 'BTC', GET_TICK: '^123', GET_AMOUNT: '20',
            GET_ADDRESS: BTC_ADDRESS.address,
        });
    });
});

// An order side's asset is one picker page: a token row, or the native coin row.
async function pickOrderAsset(utils, side, rowName) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: new RegExp(`^${side} asset:`) }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: rowName }));
        await drainMicrotasks();
    });
}
const TOKEN_ROW = (tick) => new RegExp(`^Select ${tick}(?: on |$)`);
const COIN_ROW = /^Select Dogecoin(?: on |$)/;

describe('CreateOrderForm state safety', () => {
    it('clears stale values when an order side changes asset kind', async () => {
        // The picker lists the native coin row once the address holds some.
        const { utils } = await mountCreate({}, {
            getWalletBalances: () => Promise.resolve({
                [DOGE]: [{
                    address: DOGE_ADDRESS.address,
                    balances: {
                        native: { tick: 'DOGE', quantity: '1000000000', divisibility: 8 },
                        tokens: [{ tick: 'JDOG', displayName: 'JDOG', quantity: '1000', divisibility: 0 }],
                    },
                }],
            }),
        });
        await pickOrderAsset(utils, 'Give', TOKEN_ROW('JDOG'));
        await domAct(async () => {
            setValue(utils, /^Give amount/, '12');
            await drainMicrotasks();
        });

        // The ownership switch sits in the closed Ownership section.
        const ownership = utils.getByLabelText('Trade ownership of JDOG (not a balance)');
        await domAct(async () => {
            fireEvent.click(ownership);
            fireEvent.click(ownership);
            await drainMicrotasks();
        });
        expect(utils.getByLabelText(/^Give amount/).value).toBe('');

        await domAct(async () => {
            setValue(utils, /^Give amount/, '12');
            await drainMicrotasks();
        });
        await pickOrderAsset(utils, 'Give', COIN_ROW);
        expect(utils.getByLabelText(/^Give amount \(DOGE\)/).value).toBe('');

        await pickOrderAsset(utils, 'Give', TOKEN_ROW('JDOG'));
        expect(utils.getByLabelText(/^Give amount/).value).toBe('');
    });

    it('dispatches only one watcher build when two submit events arrive in one render', async () => {
        let builds = 0;
        let finishBuild;
        const pending = new Promise((resolve) => { finishBuild = resolve; });
        const { utils } = await mountCreate({}, {
            getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
            buildActionPsbtRequest: () => {
                builds += 1;
                return pending;
            },
        });
        await pickOrderAsset(utils, 'Give', TOKEN_ROW('JDOG'));
        await domAct(async () => {
            setValue(utils, /^Give amount/, '5');
            setValue(utils, /^Get amount/, '10');
            await drainMicrotasks();
        });
        await domAct(async () => {
            // Create order names its action Place Order in watcher mode too (U63).
            fireEvent.click(utils.getByRole('button', { name: 'Place Order' }));
            await drainMicrotasks();
        });

        const approve = utils.getByRole('button', { name: 'Approve' });
        await domAct(async () => {
            fireEvent.click(approve);
            fireEvent.click(approve);
            await drainMicrotasks();
        });
        expect(builds).toBe(1);
        await domAct(async () => {
            finishBuild({ psbtHex: 'unsigned-same-chain' });
            await drainMicrotasks();
        });
    });

    it('ignores a duplicate full-wallet submit while compose is pending', async () => {
        let composes = 0;
        let rejectCompose;
        const pending = new Promise((resolve, reject) => { rejectCompose = reject; });
        const { utils } = await mountCreate({}, {
            composeForConfirm: () => {
                composes += 1;
                return pending;
            },
        });
        await pickOrderAsset(utils, 'Give', TOKEN_ROW('JDOG'));
        await domAct(async () => {
            setValue(utils, /^Give amount/, '5');
            setValue(utils, /^Get amount/, '10');
            await drainMicrotasks();
        });
        const form = utils.getByRole('button', { name: 'Place Order' }).closest('form');
        await domAct(async () => {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await drainMicrotasks();
        });
        expect(composes).toBe(1);
        expect(utils.container.textContent).not.toMatch(/confirmation is already in progress/i);

        await domAct(async () => {
            rejectCompose(Object.assign(new Error('cancelled'), { reason: 'user-rejected' }));
            await drainMicrotasks();
        });
    });
});

// Receive at is its own standard address field right under You get, in both
// views, holding this wallet's address on the get chain until it is edited.
describe('CrossChainOrderForm Receive at field', () => {
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it('sits right after You get in Quick, labelled Receive at, with the addresses icon', async () => {
        const { utils } = await mount({ initialChainId: DOGE });
        const field = utils.getByLabelText('Receive at');
        expect(follows(utils.getByText('You get'), field)).toBe(true);
        expect(utils.getByRole('button', { name: 'Choose receive address' })).toBeTruthy();
        // The old read-only row is gone: one Receive at control, not two.
        expect(utils.getAllByLabelText('Receive at')).toHaveLength(1);
    });

    it('sits after Get amount and before the rate in Full', async () => {
        const { utils } = await mount({ initialChainId: DOGE });
        await showFull(utils);
        const field = utils.getByLabelText('Receive at');
        expect(follows(utils.getByLabelText(/^Get amount/), field)).toBe(true);
        expect(follows(field, utils.getByText('Enter both amounts to see the rate'))).toBe(true);
    });

    it('defaults to this wallet\'s address on the You get chain, per chain', async () => {
        const onDoge = await mount({ initialChainId: DOGE });
        expect(onDoge.utils.getByLabelText('Receive at').value).toBe(BTC_ADDRESS.address);
        cleanup();
        const onBtc = await mount({ initialChainId: BTC });
        expect(onBtc.utils.getByLabelText('Receive at').value).toBe(DOGE_ADDRESS.address);
    });

    it('submits a custom receive address as GET_ADDRESS', async () => {
        const custom = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await fillPair(utils);
        await domAct(async () => {
            setValue(utils, 'Receive at', custom);
            await drainMicrotasks();
        });
        await placeAndApprove(utils);
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params.GET_ADDRESS).toBe(custom);
    });

    it('shows the field error for an address that is not valid on the You get chain', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await fillPair(utils);
        await domAct(async () => {
            setValue(utils, 'Receive at', 'not an address');
            await drainMicrotasks();
        });
        // The field carries the error before submit; the enabled action repeats
        // it in the top summary and still composes nothing.
        expect(utils.getByLabelText('Receive at')).toHaveAttribute('aria-invalid', 'true');
        expect(utils.getAllByText('This is not a valid address.')).toHaveLength(1);
        const place = utils.getByRole('button', { name: 'Place Order' });
        expect(place).toBeEnabled();
        fireEvent.click(place);
        expect(utils.getByLabelText('Form errors')).toHaveTextContent('This is not a valid address.');
        expect(utils.getAllByText('This is not a valid address.')).toHaveLength(2);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('resets to the new chain\'s default when the You get chain changes', async () => {
        const { utils } = await mount({ initialChainId: DOGE }, multiChainOverrides());
        expect(utils.getByLabelText('Receive at').value).toBe(`newest-on-${BTC}`);
        await domAct(async () => {
            setValue(utils, 'Receive at', 'typed-by-user');
            await drainMicrotasks();
        });
        await pickGetTokenFromList(utils, 'LTCTOK');
        expect(utils.getByLabelText('Receive at').value).toBe('newest-on-litecoin-mainnet');
    });
});
