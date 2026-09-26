// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The create form's allow-list self-check has to judge the membership the
// network will use and the address the dispenser will open on.
//
//   - A list that was edited resolves to its newest valid edit
//     (`state.current_list`); the as-created `list` warned about an address
//     that was on the list, and the picker undercounted it.
//   - In "new dispenser address" mode the check used SOURCE until a preview
//     had derived the real address, so a listed SOURCE hid a dispenser that
//     would refuse every sale. It now warns before the preview and again on
//     the confirm screen, naming the derived address.
//   - A rejected preview's derived address is reused by the next form, rather
//     than leaving one more unused "Dispenser #n" record behind.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { clearUnusedDispenserAddresses } from '../../../packages/core/src/shared/utils/unusedDispenserAddress.js';

const CHAIN = 'bitcoin-mainnet';
const LIST = '2701';

const SOURCE = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const REUSABLE = Object.freeze({
    id: 'addr-disp-1',
    address: 'bc1qreusablereusablereusablereusablereusab',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    role: 'dispenser',
    signerId: 'signer-1',
});
const DERIVED = Object.freeze({
    id: 'addr-disp-2',
    address: 'bc1qderivedderivedderivedderivedderivedde',
    publicKey: '02001122',
    derivationPath: "m/84'/0'/0'/0/2",
    source: 'hd',
    role: 'dispenser',
});
const BUYER = 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';

beforeEach(() => {
    clearUnusedDispenserAddresses();
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** A host whose list #2701 was created with `created` and now resolves to `current`. */
function recordingMessaging({ created, current, derivedHeld = false }) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({
            [CHAIN]: derivedHeld ? [SOURCE, REUSABLE, DERIVED] : [SOURCE, REUSABLE],
        }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: SOURCE.id, address: SOURCE.address } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        getListsForSource: ({ address }) => Promise.resolve(address === SOURCE.address
            ? [{ action_index: Number(LIST), type: 2, status: 'valid', block_index: 10 }]
            : []),
        getListByActionIndex: ({ actionIndex }) => Promise.resolve(actionIndex === LIST ? {
            action_index: Number(LIST),
            type: 2,
            source: SOURCE.address,
            list: [...created],
            state: { edit_resolution_active: true, membership_action_index: 3069, current_list: [...current] },
        } : null),
        generateDispenserAddress: (args) => {
            calls.push({ method: 'generateDispenserAddress', args });
            return Promise.resolve({ ...DERIVED });
        },
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
                return Promise.resolve({ txid: `tx-${String(prop)}`, rows: [] });
            };
        },
    });
    return { messaging, calls };
}

async function drainMicrotasks(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

async function mountForm(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserForm, { walletId: 'w', initialChainId: CHAIN, initialTick: 'JDOG', onBack() {} }),
        ));
        await drainMicrotasks();
    });
    return utils;
}

async function fillAmounts(utils) {
    await step(() => {
        fireEvent.change(utils.getByLabelText(/^Give amount/), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText(/^Escrow amount/), { target: { value: '100' } });
        fireEvent.change(utils.getByLabelText(/^Trigger price/), { target: { value: '0.001' } });
    });
}

/** Open the allow-list picker and return the row's member-count text before picking it. */
async function pickAllowList(utils) {
    await step(() => fireEvent.click(utils.getByRole('button', { name: 'Set allow-list' })));
    const row = utils.getByText(`Address list #${LIST}`).closest('button');
    const countText = row.textContent;
    await step(() => fireEvent.click(row));
    return countText;
}

async function pickDispenserAddress(utils, address) {
    await step(() => fireEvent.click(utils.getByRole('button', { name: 'Change dispenser address' })));
    await step(() => fireEvent.click(utils.getByRole('button', { name: `View address ${address}` })));
}

const clickCreate = (utils) => step(() => fireEvent.click(utils.getByRole('button', { name: 'Create' })));

describe('DispenserForm allow-list self-check reads the list as the network resolves it', () => {
    it('an edit that added the dispenser address clears the warning, and the picker counts the edit', async () => {
        const { messaging, calls } = recordingMessaging({
            created: [SOURCE.address, BUYER],
            current: [SOURCE.address, BUYER, REUSABLE.address],
        });
        const utils = await mountForm(messaging);
        await pickDispenserAddress(utils, REUSABLE.address);
        const countText = await pickAllowList(utils);
        expect(countText).toContain('3 members');
        await fillAmounts(utils);
        expect(utils.container.textContent).not.toMatch(/is not on the allow-list/);

        await clickCreate(utils);
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose, 'the preview opened').toBeTruthy();
        expect(compose.args.actionData.params).toMatchObject({ GET_ADDRESS: REUSABLE.address, ALLOW_LIST: LIST });
    });
});

describe('DispenserForm allow-list self-check judges the address the dispenser opens on', () => {
    it('new-address mode with a listed SOURCE warns, and the confirm screen names the derived address', async () => {
        const { messaging, calls } = recordingMessaging({
            created: [SOURCE.address, BUYER],
            current: [SOURCE.address, BUYER],
        });
        const utils = await mountForm(messaging);
        await pickAllowList(utils);
        await fillAmounts(utils);
        // The warning is up before Create, with the create-first remedy.
        expect(utils.container.textContent).toMatch(/The new dispenser address will not be on the allow-list/);
        expect(utils.container.textContent).toMatch(/Create the dispenser first, then add its address to the list/);

        // A warning, not a block: the preview opens on the derived address.
        await clickCreate(utils);
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose, 'the preview opened').toBeTruthy();
        expect(compose.args.actionData.params.GET_ADDRESS).toBe(DERIVED.address);
        expect(utils.getByTestId('confirm-reject')).toBeTruthy();
        expect(utils.container.textContent).toContain(`This dispenser's own address (${DERIVED.address.slice(0, 8)}`);
        expect(utils.container.textContent).toMatch(/Every purchase would be refused/);
    });

    it('an existing dispenser address off the list warns on the form and the confirm screen, and clearing the list drops it', async () => {
        const { messaging, calls } = recordingMessaging({
            created: [SOURCE.address, BUYER],
            current: [SOURCE.address, BUYER],
        });
        const utils = await mountForm(messaging);
        await pickDispenserAddress(utils, REUSABLE.address);
        await pickAllowList(utils);
        await fillAmounts(utils);
        const warning = `This dispenser's own address (${REUSABLE.address.slice(0, 8)}`;
        expect(utils.container.textContent).toContain(warning);

        await clickCreate(utils);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(true);
        expect(utils.container.textContent).toContain(warning);
        await step(() => fireEvent.click(utils.getByTestId('confirm-reject')));

        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Clear' })));
        expect(utils.container.textContent).not.toContain(warning);
    });
});

describe('DispenserForm reuses the address derived for a rejected preview', () => {
    it('a reopened form previews on the same derived address instead of deriving another', async () => {
        const { messaging, calls } = recordingMessaging({ created: [], current: [], derivedHeld: true });
        const first = await mountForm(messaging);
        await fillAmounts(first);
        await clickCreate(first);
        await step(() => fireEvent.click(first.getByTestId('confirm-reject')));
        first.unmount();

        const second = await mountForm(messaging);
        await fillAmounts(second);
        await clickCreate(second);

        const derivations = calls.filter((c) => c.method === 'generateDispenserAddress');
        expect(derivations).toHaveLength(1);
        const composes = calls.filter((c) => c.method === 'composeForConfirm');
        expect(composes).toHaveLength(2);
        expect(composes[1].args.actionData.params.GET_ADDRESS).toBe(DERIVED.address);
    });
});
