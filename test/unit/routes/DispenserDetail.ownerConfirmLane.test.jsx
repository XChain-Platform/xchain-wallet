// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dispenser owner actions (Close, Refill, Edit) on the shared confirm
// lane. They used to sign straight from their own forms, so a list edit that
// can never be removed was signed with no decoded review and no dry run.
// These pin that the pre-flight runs before any signature and can stop it,
// that the device lane signs the same composed bytes, that watcher mode still
// builds unsigned, and that the edit form checks the NEW allow-list and
// refuses one list in both slots.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ title, onSelect }) => (
        <div>
            {['2701', '2702'].map((index) => (
                <button
                    key={index}
                    type="button"
                    onClick={() => onSelect({ actionIndex: index, name: index === '2701' ? 'Buyers' : null })}
                >
                    Pick {title.startsWith('Choose Allow') ? 'Allow' : 'Block'} {index}
                </button>
            ))}
        </div>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qownerownerownerownerownerownerownerown';
const BUYER = 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';

const OWNER_ADDRESS = Object.freeze({
    id: 'addr-owner', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const HW_OWNER = Object.freeze({ ...OWNER_ADDRESS, id: 'addr-hw', source: 'trezor', signerId: 'signer-hw' });

const DISPENSER = Object.freeze({
    action_index: '2868',
    source: OWNER,
    address: OWNER,
    give_tick: 'XCHAIN',
    give_amount: '25',
    get_coin: 'BTC',
    get_amount: '0.001',
    allow_list: null,
    block_list: null,
    escrow_remaining: '100',
    status: 'open',
    current_status: 'open',
});

const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
const PASS = Object.freeze({ verdict: 'pass', findings: [] });
const REFUSED = Object.freeze({
    verdict: 'fail',
    findings: [{ severity: 'error', overridable: false, code: 'INVALID_FIELD_VALUE', message: 'The network would refuse this action.' }],
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
afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.useRealTimers();
});

async function drainMicrotasks(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

/** Every host call in order, so a test can prove the dry run came first. */
function recordingMessaging({
    owner = OWNER_ADDRESS,
    dispenser = DISPENSER,
    settings = {},
    walletMode = 'full',
    preflight = PASS,
    lists = {},
    chainId = CHAIN,
    buildActionPsbtRequest,
    walletBalances,
    getDispenserByActionIndex,
} = {}) {
    const calls = [];
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getDispenserByActionIndex: getDispenserByActionIndex || (() => Promise.resolve(dispenser)),
        getAddressesByChain: () => Promise.resolve({ [chainId]: [owner] }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: () => Promise.resolve({ data: [] }),
        getDispenserLifecycle: () => Promise.resolve({ data: [] }),
        getWalletBalances: () => Promise.resolve(walletBalances || {
            [chainId]: [{
                address: owner.address,
                balances: { tokens: [{ tick: 'XCHAIN', quantity: '10000000000', divisibility: 8 }] },
            }],
        }),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: owner.source === 'hd' ? 'unlocked' : 'available' }),
        getListByActionIndex: ({ actionIndex }) => Promise.resolve(lists[actionIndex] ?? null),
        composeForConfirm: log('composeForConfirm', COMPOSED),
        preflight: log('preflight', preflight),
        buildActionPsbtRequest: (args) => {
            calls.push({ method: 'buildActionPsbtRequest', args });
            return buildActionPsbtRequest
                ? buildActionPsbtRequest(args)
                : Promise.resolve({ psbtHex: 'bb00', encoding: 'psbt', fromAddress: owner.address });
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return log(String(prop), { txid: `tx-${String(prop)}`, psbtHex: 'bb00' });
        },
    });
    return { messaging, calls };
}

async function mount(opts = {}) {
    const { messaging, calls } = recordingMessaging(opts);
    const chainId = opts?.chainId || CHAIN;
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId, actionIndex: DISPENSER.action_index,
                onBack: opts.onBack || (() => {}), onCanceled() {},
            }),
        ));
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

// The owner's Refill, setting rows and Close are rows of the Actions tab's
// action list (G101), the tab the page opens on; a row's name is its title followed
// by its description, so each is matched by the title it starts with.
const CLOSE_ROW = /^Close(?! Dispenser$)/;
const REFILL_ROW = /^Refill(?! Dispenser$)/;
// Each setting has its own edit page (G104): the lists page by default, or
// the expiration page.
async function openEdit(utils, page = 'lists') {
    const row = page === 'expiration' ? /^Change expiration/ : /^Allow and block lists/;
    await step(() => fireEvent.click(utils.getByRole('button', { name: row })));
}
// The edit panel's list fields are pickers (G114): open one, then choose a list
// in the picker (mocked above to offer lists 2701 and 2702).
async function pickList(utils, kind, index) {
    await step(() => fireEvent.click(utils.getByRole('button', { name: new RegExp(`^${kind} list:`) })));
    await step(() => fireEvent.click(utils.getByRole('button', { name: `Pick ${kind} ${index}` })));
}

const approveButton = (utils) => utils.container.querySelector('[data-testid="confirm-approve"]');
const indexOf = (calls, method) => calls.findIndex((c) => c.method === method);
const signCalls = (calls) => calls.filter((c) => c.method === 'dispenserAction' || c.method === 'dispenserActionHw');

async function approve(utils) {
    const btn = approveButton(utils);
    if (btn && !btn.disabled) await step(() => fireEvent.click(btn));
}

describe('dispenser owner actions sign through the confirm page', () => {
    it('closes only after the pre-flight, signing the composed bytes', async () => {
        const { utils, calls } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: CLOSE_ROW })));
        const closeAction = utils.getByRole('button', { name: 'Close Dispenser' });
        expect(closeAction.className).toMatch(/danger/);
        expect(closeAction.querySelector('svg')).toBeTruthy();
        await step(() => fireEvent.click(closeAction));

        expect(signCalls(calls), 'nothing signs before Approve').toHaveLength(0);
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData).toEqual({
            action: 'DISPENSER', params: { VERSION: '1', DISPENSER_ACTION_INDEX: '2868' },
        });
        expect(utils.getByTestId('confirm-facts')).toBeTruthy();

        await approve(utils);
        expect(indexOf(calls, 'dispenserAction')).toBeGreaterThan(indexOf(calls, 'preflight'));
        const sign = calls.find((c) => c.method === 'dispenserAction');
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(sign.args.params).toEqual({ VERSION: '1', DISPENSER_ACTION_INDEX: '2868' });
    });

    it('blocks an edit the pre-flight says the network would refuse', async () => {
        const { utils, calls } = await mount({ preflight: REFUSED });
        await openEdit(utils);
        const updateAction = utils.getByRole('button', { name: 'Update Dispenser' });
        expect(updateAction.className).toMatch(/success/);
        expect(updateAction.querySelector('svg')).toBeTruthy();
        // The lists page holds the two optional list fields and no date.
        expect(utils.container.querySelectorAll('[data-optional-pill]')).toHaveLength(2);
        expect(utils.queryByLabelText('New expiration')).toBeNull();
        for (const fieldName of ['Allow list', 'Block list']) {
            const help = utils.getByRole('button', { name: `About ${fieldName}` });
            fireEvent.click(help);
            expect(utils.getAllByRole('tooltip').some((tip) => Boolean(tip.textContent))).toBe(true);
            fireEvent.click(help);
        }
        await pickList(utils, 'Block', '2702');
        // The picker replaced the page, so the form's button is a new element.
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' })));
        await approve(utils);

        expect(calls.some((c) => c.method === 'preflight')).toBe(true);
        expect(approveButton(utils), 'a hard refusal disables Approve').toBeDisabled();
        await step(() => fireEvent.click(approveButton(utils)));
        expect(signCalls(calls)).toHaveLength(0);
    });

    it('refills a hardware owner on the device lane with the same composed bytes', async () => {
        const { utils, calls } = await mount({ owner: HW_OWNER, dispenser: { ...DISPENSER, source: HW_OWNER.address } });
        await step(() => fireEvent.click(utils.getByRole('button', { name: REFILL_ROW })));
        const refillAction = utils.getByRole('button', { name: 'Refill Dispenser' });
        expect(refillAction.className).toMatch(/success/);
        expect(refillAction.querySelector('svg')).toBeTruthy();
        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '50' } }));
        await step(() => fireEvent.click(refillAction));
        await approve(utils);

        const sign = calls.find((c) => c.method === 'dispenserActionHw');
        expect(sign, 'signed on the device lane').toBeTruthy();
        expect(indexOf(calls, 'dispenserActionHw')).toBeGreaterThan(indexOf(calls, 'preflight'));
        expect(sign.args.signerId).toBe('signer-hw');
        expect(sign.args.password, 'no password rides the device lane').toBeUndefined();
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
        expect(sign.args.params.GIVE_ESCROW).toBe('50');
    });

    it('shows the exact refill asset and amount that the build receives, then Back keeps the value', async () => {
        const { utils, calls } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: REFILL_ROW })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '37.50' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill Dispenser' })));

        const review = utils.getByTestId('refill-review-summary');
        expect(review).toHaveTextContent('Dispenser#2868');
        expect(review).toHaveTextContent('Add to escrow37.50 XCHAIN');
        expect(calls.find((c) => c.method === 'composeForConfirm').args.actionData.params.GIVE_ESCROW).toBe('37.50');

        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Back to previous screen' })));
        expect(utils.getByLabelText(/^Refill amount/)).toHaveValue('37.50000000');
    });

    it('rejects zero, excess precision, less than one fill, and amounts above balance before review', async () => {
        const walletBalances = {
            [CHAIN]: [{
                address: OWNER,
                balances: { tokens: [{ tick: 'XCHAIN', quantity: '5', divisibility: 0 }] },
            }],
        };
        const { utils, calls } = await mount({
            walletBalances,
            dispenser: { ...DISPENSER, give_amount: '2' },
        });
        await step(() => fireEvent.click(utils.getByRole('button', { name: REFILL_ROW })));
        await domAct(async () => { await vi.advanceTimersByTimeAsync(400); });

        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '0' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill Dispenser' })));
        expect(utils.getByText('Refill amount must be a positive number.')).toBeInTheDocument();

        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '1.1' } }));
        expect(utils.getByText('Amount can have at most 0 decimal places.')).toBeInTheDocument();

        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '1' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill Dispenser' })));
        expect(utils.getByText('Refill amount must be at least one fill (2 XCHAIN).')).toBeInTheDocument();

        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '6' } }));
        await domAct(async () => { await vi.advanceTimersByTimeAsync(400); });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill Dispenser' })));
        expect(utils.getByText(/This address holds only 5 XCHAIN/)).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('rechecks live state and refuses a second close when the dispenser starts closing', async () => {
        const getDispenserByActionIndex = vi.fn()
            .mockResolvedValueOnce(DISPENSER)
            .mockResolvedValueOnce({ ...DISPENSER, current_status: 'cancelling' });
        const { utils, calls } = await mount({ getDispenserByActionIndex });
        await step(() => fireEvent.click(utils.getByRole('button', { name: CLOSE_ROW })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Close Dispenser' })));

        expect(utils.getByText('This dispenser is already closing.')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(signCalls(calls)).toHaveLength(0);
    });

    it('keeps watcher mode on its unsigned build, with no signature to pre-flight', async () => {
        const { utils, calls } = await mount({ walletMode: 'watcher' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: CLOSE_ROW })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Create Unsigned Transaction' })));

        const build = calls.find((c) => c.method === 'buildActionPsbtRequest');
        expect(build.args.actionData.action).toBe('DISPENSER');
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(signCalls(calls)).toHaveLength(0);
        expect(utils.getByLabelText('Unsigned transaction code')).toHaveValue('bb00');
    });

    it('shows close build errors, clears them when the fee changes, and returns unsigned output to the list', async () => {
        const onBack = vi.fn();
        const failed = await mount({
            walletMode: 'watcher',
            buildActionPsbtRequest: vi.fn().mockRejectedValue(new Error('Could not build close.')),
        });
        await step(() => fireEvent.click(failed.utils.getByRole('button', { name: CLOSE_ROW })));
        await step(() => fireEvent.click(failed.utils.getByRole('button', { name: 'Create Unsigned Transaction' })));
        // An unclassified build error reaches the user as the generic house line.
        expect(failed.utils.getByText(/Something went wrong\. Try again\./)).toBeInTheDocument();
        await step(() => fireEvent.change(failed.utils.getByLabelText('Network fee'), { target: { value: '2' } }));
        expect(failed.utils.queryByText(/Something went wrong\. Try again\./)).toBeNull();
        failed.utils.unmount();

        let resolveBuild;
        const success = await mount({
            walletMode: 'watcher',
            onBack,
            buildActionPsbtRequest: () => new Promise((resolve) => { resolveBuild = resolve; }),
        });
        await step(() => fireEvent.click(success.utils.getByRole('button', { name: CLOSE_ROW })));
        expect(success.utils.getByTestId('close-escrow-destination')).toHaveTextContent('Remaining escrow: 100 XCHAIN.');
        await domAct(async () => {
            fireEvent.click(success.utils.getByRole('button', { name: 'Create Unsigned Transaction' }));
            await Promise.resolve();
        });
        expect(success.utils.getByRole('button', { name: 'Create Unsigned Transaction' })).toBeDisabled();
        await domAct(async () => {
            resolveBuild({ psbtHex: 'bb00', encoding: 'psbt', fromAddress: OWNER });
            await drainMicrotasks();
        });
        const done = success.utils.getByRole('button', { name: 'Done' });
        expect(done.querySelector('svg')).toBeTruthy();
        fireEvent.click(done);
        expect(onBack).toHaveBeenCalledOnce();
    });
});

describe('dispenser edit checks the lists it is about to bind', () => {
    it('shows the exact expiration that the expiration page\'s edit build receives', async () => {
        const { utils, calls } = await mount();
        await openEdit(utils, 'expiration');
        // The expiration page holds the one date field and no list field.
        expect(utils.queryByRole('button', { name: /^Allow list:/ })).toBeNull();
        fireEvent.click(utils.getByRole('button', { name: 'About New expiration' }));
        expect(utils.getAllByRole('tooltip').some((tip) => Boolean(tip.textContent))).toBe(true);
        await step(() => fireEvent.change(utils.getByLabelText('New expiration'), {
            target: { value: '2099-01-02T03:04' },
        }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' })));

        const expectedUnix = String(Math.floor(Date.parse('2099-01-02T03:04') / 1000));
        const params = calls.find((c) => c.method === 'composeForConfirm').args.actionData.params;
        expect(params).toEqual({ VERSION: '2', DISPENSER_ACTION_INDEX: '2868', EXPIRATION: expectedUnix });
        const review = utils.getByTestId('edit-review-summary');
        expect(review).toHaveTextContent(`Unix ${expectedUnix}`);
    });

    it('shows the exact list IDs that the lists page\'s edit build receives', async () => {
        const { utils, calls } = await mount();
        await openEdit(utils);
        await pickList(utils, 'Allow', '2701');
        expect(utils.getByRole('button', { name: 'Allow list: Buyers (List #2701)' })).toBeTruthy();
        await pickList(utils, 'Block', '2702');
        expect(utils.getByRole('button', { name: 'Block list: List #2702' })).toBeTruthy();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' })));

        const params = calls.find((c) => c.method === 'composeForConfirm').args.actionData.params;
        expect(params).toEqual({
            VERSION: '2', DISPENSER_ACTION_INDEX: '2868', ALLOW_LIST: '2701', BLOCK_LIST: '2702',
        });
        const review = utils.getByTestId('edit-review-summary');
        expect(review).toHaveTextContent('Allow list#2701');
        expect(review).toHaveTextContent('Block list#2702');
    });

    it('drops a list picked and then left behind from a later expiration edit', async () => {
        const { utils, calls } = await mount();
        await openEdit(utils);
        await pickList(utils, 'Allow', '2701');
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Back to previous screen' })));
        await openEdit(utils, 'expiration');
        await step(() => fireEvent.change(utils.getByLabelText('New expiration'), {
            target: { value: '2099-01-02T03:04' },
        }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' })));

        const params = calls.find((c) => c.method === 'composeForConfirm').args.actionData.params;
        expect(params.ALLOW_LIST).toBeUndefined();
        expect(Object.keys(params).sort()).toEqual(['DISPENSER_ACTION_INDEX', 'EXPIRATION', 'VERSION']);
    });

    it('offers removal on regtest and sends the zero sentinel', async () => {
        const dispenser = { ...DISPENSER, allow_list: '2701' };
        const { utils, calls } = await mount({ dispenser, chainId: 'bitcoin-regtest' });
        await openEdit(utils);
        // The bound list reads by number until the host knows its name; the
        // empty block list reads "None set".
        expect(utils.getByRole('button', { name: 'Allow list: List #2701' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Block list: None set' })).toBeTruthy();
        const remove = utils.getByRole('button', { name: 'Remove allow list' });
        expect(remove.querySelector('svg')).toBeTruthy();
        await step(() => fireEvent.click(remove));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' })));

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params).toEqual({
            VERSION: '2', DISPENSER_ACTION_INDEX: '2868', ALLOW_LIST: '0',
        });
    });

    it('keeps removal hidden on an unarmed network', async () => {
        const { utils } = await mount({ dispenser: { ...DISPENSER, allow_list: '2701' } });
        await openEdit(utils);
        expect(utils.queryByRole('button', { name: 'Remove allow list' })).toBeNull();
    });

    it('warns when the NEW allow-list leaves out the dispenser\'s own address', async () => {
        const { utils } = await mount({ lists: { 2701: { list: [{ address: BUYER }] } } });
        await openEdit(utils);
        await pickList(utils, 'Allow', '2701');
        await step(() => { vi.advanceTimersByTime(500); });

        expect(utils.getByText(/is not on the allow-list/)).toBeTruthy();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' })));
        expect(approveButton(utils), 'the confirm page is open').toBeTruthy();
        expect(utils.getByText(/is not on the allow-list/), 'the warning rides to the confirm page').toBeTruthy();
    });

    it('stays quiet when the new allow-list holds the dispenser\'s address', async () => {
        const { utils } = await mount({ lists: { 2701: { list: [{ address: BUYER }, { address: OWNER }] } } });
        await openEdit(utils);
        await pickList(utils, 'Allow', '2701');
        await step(() => { vi.advanceTimersByTime(500); });
        expect(utils.queryByText(/is not on the allow-list/)).toBeNull();
    });

    it('refuses the same list typed as both allow-list and block-list', async () => {
        const { utils, calls } = await mount();
        await openEdit(utils);
        await pickList(utils, 'Allow', '2701');
        await pickList(utils, 'Block', '2701');

        expect(utils.getByRole('button', { name: 'Update Dispenser' })).toBeEnabled();
        fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' }));
        await step(() => {});
        expect(utils.getByLabelText('Form errors')).toHaveTextContent(/both the allow-list and the block-list/);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('refuses an allow-list that matches the block-list already bound', async () => {
        const { utils, calls } = await mount({ dispenser: { ...DISPENSER, block_list: '2701' } });
        await openEdit(utils);
        await pickList(utils, 'Allow', '2701');

        expect(utils.getByRole('button', { name: 'Update Dispenser' })).toBeEnabled();
        fireEvent.click(utils.getByRole('button', { name: 'Update Dispenser' }));
        await step(() => {});
        expect(utils.getByLabelText('Form errors')).toHaveTextContent(/List #2701 is set as both/);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });
});
