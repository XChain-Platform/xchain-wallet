// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dispenser detail opens on Actions for every reader (G102): the dispenser's
// owner (the creator or the dispenser address) finds Refill, the setting rows
// and Close there, and anyone else finds Buy as the first row. A tab the
// reader picks stays picked.

import { describe, it, expect, afterEach } from 'vitest';
import { render, act as domAct, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const CREATOR = 'bc1qownerownerownerownerownerownerownerown';
const HOST = 'bc1qdispdispdispdispdispdispdispdispdispdi';

const address = (id, value, index) => Object.freeze({
    id, address: value, publicKey: '02aa', derivationPath: `m/84'/0'/0'/0/${index}`,
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const CREATOR_ADDRESS = address('addr-creator', CREATOR, 0);
const HOST_ADDRESS = address('addr-host', HOST, 5);
const BUYER_ADDRESS = address('addr-buyer', 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbuy', 3);

const OPEN = Object.freeze({
    action_index: '4100',
    source: CREATOR,
    get_address: HOST,
    give_tick: 'XCHAIN',
    give_amount: '25',
    give_escrow: '100',
    give_ownership: 0,
    get_coin: 'BTC',
    get_tick: null,
    get_amount: '0.001',
    allow_list: null,
    block_list: null,
    status: 'valid',
    current_status: 'open',
    state: { status: 'open', give_remaining: '100', expiration: null, allow_list: null, block_list: null },
});

afterEach(() => { cleanup(); });

function messagingFor(addresses) {
    const target = {
        getDispenserByActionIndex: () => Promise.resolve(OPEN),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: addresses }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: () => Promise.resolve({ data: [] }),
        getDispenserLifecycle: () => Promise.resolve({ data: [] }),
        getWalletBalances: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'available' }),
        getListByActionIndex: () => Promise.resolve(null),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve(null);
        },
    });
}

async function mount(addresses) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: messagingFor(addresses) },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: OPEN.action_index,
                onBack() {}, onCanceled() {}, onOpenAgain() {},
            }),
        ));
    });
    // The dispenser and the wallet's addresses arrive over several reads.
    await utils.findByRole('tablist', { name: 'Dispenser sections' });
    await domAct(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    return utils;
}

// The Actions | Details | Activity strip under the hero.
const sections = (utils) => within(utils.getByRole('tablist', { name: 'Dispenser sections' }));
const sectionTab = (utils, name) => sections(utils).getByRole('tab', { name });
const selectedSection = (utils) => sections(utils).getAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true');
const selectedTab = (utils) => selectedSection(utils)?.textContent;
// The section panel shown is the one the chosen section tab labels.
const panelTab = (utils) => {
    const id = selectedSection(utils)?.id;
    return utils.container.querySelector(`[role="tabpanel"][aria-labelledby="${id}"]`)
        ?.getAttribute('aria-labelledby');
};

describe('Dispenser detail first tab', () => {
    it.each([
        ['the creator', CREATOR_ADDRESS],
        ['the dispenser address', HOST_ADDRESS],
    ])('opens on Actions for %s', async (_who, owner) => {
        const utils = await mount([owner]);
        expect(selectedTab(utils)).toBe('Actions');
        expect(panelTab(utils)).toMatch(/-tab-actions$/);
        expect(utils.getByRole('button', { name: /^Close(?! Dispenser$)/ })).toBeTruthy();
    });

    it('opens on Actions for a buyer who does not own the dispenser, with Buy first', async () => {
        const utils = await mount([BUYER_ADDRESS]);
        expect(selectedTab(utils)).toBe('Actions');
        expect(panelTab(utils)).toMatch(/-tab-actions$/);
        expect(utils.queryByRole('button', { name: /^Close(?! Dispenser$)/ })).toBeNull();
        const rows = within(utils.getByRole('list', { name: 'Dispenser actions' })).getAllByRole('listitem');
        expect(rows[0].textContent).toMatch(/^Buy/);
        expect(sections(utils).queryByRole('tab', { name: 'Buy' })).toBeNull();
    });

    it('keeps the tab the reader picks', async () => {
        const buyer = await mount([BUYER_ADDRESS]);
        await domAct(async () => { fireEvent.click(sectionTab(buyer, 'Details')); });
        expect(selectedTab(buyer)).toBe('Details');
        cleanup();

        const owner = await mount([HOST_ADDRESS]);
        await domAct(async () => { fireEvent.click(sectionTab(owner, 'Activity')); });
        expect(selectedTab(owner)).toBe('Activity');
        expect(panelTab(owner)).toMatch(/-tab-activity$/);
    });
});
