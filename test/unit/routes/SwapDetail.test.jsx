// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Swap Details (operator ruling 2026-11-13): the page a My Swaps row opens,
// in the approved ring layout (wallet-orders-layout-1-ring). The header is
// the large fill ring (0% or 100%: a swap is single-fill), "Swapping", the
// give amount, what it is for and the status. Then the Actions | Details |
// Matches toggle (G102), Actions first: Edit and Cancel while the swap is
// open and owned, the explorer and Copy transaction ID (G101). Details holds
// the facts (no copy buttons); Matches the lifecycle, the same layout as
// Order detail. Edit and Cancel are standard forms on their own routes,
// drawn in place where the host has none. Its reads are fixed, whatever the
// swap's history.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapDetail, loadSwapDetail } from '../../../packages/core/src/shared/routes/SwapDetail.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3 * 3600;
const TX = 'f'.repeat(64);

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function swapDetail(extra = {}, state = { status: 'open', expiration: FUTURE }) {
    return {
        action: 'SWAP', action_index: '812', source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE - 3600, allow_list: '2701', block_list: null,
        block_index: '67882087', tx_hash: TX, status: 'valid',
        state: { allow_list: '2701', block_list: null, ...state },
        ...extra,
    };
}

function harness({ detail = swapDetail(), cancels = [], lifecycleRows = [], addresses = [HD_ADDRESS] } = {}) {
    const reads = [];
    const counted = (name, fn) => vi.fn((...args) => { reads.push(name); return fn(...args); });
    const target = {
        getAddressesByChain: counted('getAddressesByChain', async () => ({ [CHAIN]: addresses })),
        getSwapDetail: counted('getSwapDetail', async () => ({ data: detail })),
        getSwapCancelsForAddress: counted('getSwapCancelsForAddress', async () => ({ data: cancels })),
        getSwapsForAddress: counted('getSwapsForAddress', async () => ({ data: [] })),
        getSwapLifecycle: counted('getSwapLifecycle', async () => ({ data: lifecycleRows })),
        getSignerStatus: async () => ({ status: 'locked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, reads };
}

async function drain(rounds = 40) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function open(messaging, extra = {}) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(SwapDetail, { walletId: 'w', chainId: CHAIN, actionIndex: '812', onBack() {}, ...extra })));
        await drain();
    });
    return utils;
}

// Picks the Actions or Details tab of the toggle (G102).
async function chooseTab(utils, name) {
    const tab = utils.queryByRole('tab', { name });
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
        await domAct(async () => { fireEvent.click(tab); await drain(); });
    }
}

// A detail page's action rows (G101) are named by their title, then their description.
const action = (title) => ({ name: new RegExp(`^${title}`) });
const header = (utils) => utils.container.querySelector('[data-trade-header]');
const facts = (utils) => utils.container.querySelector('dl[aria-label="Swap Details"]');

afterEach(() => cleanup());

describe('Swap Details', () => {
    it('leads with the large ring, the swap in words and its status', async () => {
        const { messaging } = harness();
        const utils = await open(messaging);

        expect(utils.getByRole('heading', { name: 'Swap Details' })).toBeTruthy();
        const card = header(utils);
        const ring = card.querySelector('[data-fill-ring]');
        expect(ring).toHaveAttribute('data-size', 'lg');
        expect(ring).toHaveAttribute('data-percent', '0');
        expect(ring).toHaveAttribute('data-tone', 'accent');
        expect(within(card).getByText('Swapping')).toBeTruthy();
        expect(within(card).getByTestId('swap-detail-give')).toHaveTextContent('500 DOGESWAP');
        expect(within(card).getByTestId('swap-detail-get')).toHaveTextContent('for 10.5 DOGE');
        expect(within(card).getByTestId('swap-detail-status')).toHaveTextContent('Open');
        const topLine = card.querySelector('[data-trade-header-top-line]');
        expect(within(topLine).getByText('Swapping')).toBeTruthy();
        expect(within(topLine).getByTestId('swap-detail-status')).toHaveTextContent('Open');
        expect(topLine.nextElementSibling).toHaveTextContent('500 DOGESWAP');
        expect(topLine.nextElementSibling.nextElementSibling).toHaveTextContent('for 10.5 DOGE');
    });

    it('shows Actions first and chosen, every action one ActionList row', async () => {
        const { messaging } = harness();
        const utils = await open(messaging);

        const tabs = utils.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'Matches']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        for (const tab of tabs) expect(tab.querySelector('svg')).not.toBeNull();
        const actions = utils.getByRole('list', { name: 'Swap actions' });
        expect(within(actions).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
            'Edit swapChange the expiry or the allow and block lists',
            "View on the explorerThe swap's transaction",
            'Copy transaction IDffff…ffff',
            'Cancel swapReturns the 500 DOGESWAP still escrowed',
        ]);
        expect(utils.getByRole('button', action('Cancel swap'))).toHaveAttribute('data-tone', 'danger');
        const explorer = utils.getByRole('link', action('View on the explorer'));
        expect(explorer).toHaveAttribute('href', expect.stringMatching(new RegExp(`/TDOGE/tx/${TX}$`)));
        expect(explorer).toHaveAttribute('target', '_blank');
    });

    it('holds the expiry, network, owner, transaction and lists under Details', async () => {
        const { messaging } = harness();
        const utils = await open(messaging);
        await chooseTab(utils, 'Details');

        const card = facts(utils);
        // The live (edited) expiration, not the creation one.
        expect(within(card).getByTestId('swap-detail-expires'))
            .toHaveTextContent(`Expires ${formatLocalDateTime(FUTURE)}`);
        expect(within(card).getByTestId('swap-detail-network')).toHaveTextContent('Dogecoin');
        expect(within(card).getByTestId('swap-detail-index')).toHaveTextContent('#812');
        expect(within(card).getByTestId('swap-detail-from').querySelector(`[title="${OWN}"]`)).toBeTruthy();
        expect(within(card).getByTestId('swap-detail-allow-list')).toHaveTextContent('List #2701');
        expect(within(card).getByTestId('swap-detail-block-list')).toHaveTextContent('None');

        const transaction = within(card).getByTestId('swap-detail-transaction');
        expect(transaction).toHaveTextContent('ffff…ffff');
        // No copy buttons in Details (operator ruling); the explorer link stays.
        expect(within(transaction).queryByRole('button')).toBeNull();
        expect(card.querySelector('button')).toBeNull();
        const link = within(transaction).getByRole('link', { name: 'View on the explorer' });
        expect(link).toHaveAttribute('href', expect.stringMatching(new RegExp(`/TDOGE/tx/${TX}$`)));
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        // One row element per fact, as Order detail draws them too.
        for (const row of card.children) {
            expect([...row.children].map((el) => el.tagName)).toEqual(['DT', 'DD']);
        }
        // Matches moved to its own tab.
        expect(utils.queryByRole('region', { name: 'Matches' })).toBeNull();
    });

    it('shows a match in the Matches tab', async () => {
        const { messaging } = harness({
            lifecycleRows: [{
                action_index: '990', give_action_index: '812', get_action_index: '813',
                give_amount: '500', give_tick: 'DOGESWAP', block_index: '67882100',
            }],
        });
        const utils = await open(messaging);
        expect(utils.queryByRole('region', { name: 'Matches' })).toBeNull();
        await chooseTab(utils, 'Details');
        expect(utils.queryByRole('region', { name: 'Matches' })).toBeNull();
        await chooseTab(utils, 'Matches');
        expect(facts(utils)).toBeNull();
        const matches = utils.getByRole('region', { name: 'Matches' });
        expect(within(matches).getByRole('heading', { name: 'Matches' })).toBeTruthy();
        expect(within(matches).getByText('Filled / matched')).toBeTruthy();
    });

    it('opens the edit-swap and cancel-swap routes when the host wires them', async () => {
        const onEditSwap = vi.fn();
        const onCancelSwap = vi.fn();
        const { messaging } = harness();
        const utils = await open(messaging, { onEditSwap, onCancelSwap });
        fireEvent.click(utils.getByRole('button', action('Edit swap')));
        expect(onEditSwap).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '812' });
        fireEvent.click(utils.getByRole('button', action('Cancel swap')));
        expect(onCancelSwap).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '812' });
        expect(utils.queryByRole('heading', { name: 'Cancel Swap' })).toBeNull();
    });

    it('opens the standard cancel form in place from the Cancel swap row', async () => {
        const { messaging } = harness();
        const utils = await open(messaging);

        expect(utils.getByRole('button', action('Edit swap'))).toBeTruthy();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', action('Cancel swap')));
            await drain(10);
        });
        expect(utils.getByRole('heading', { name: 'Cancel Swap' })).toBeTruthy();
        expect(utils.getByRole('form', { name: 'Cancel swap' })).toBeTruthy();
        expect(utils.container.querySelector('[data-form-standard="cancel-swap"]')).not.toBeNull();
        // The cancel note moved to the review screen (G105).
        expect(utils.container.querySelector('[data-warning-line]')).toBeNull();

        // Back from the panel returns to the details.
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /back/i }));
            await drain(10);
        });
        expect(header(utils)).not.toBeNull();
    });

    it('leaves Edit and Cancel out on a settled swap or a swap this wallet does not own', async () => {
        const settled = await open(harness({ detail: swapDetail({}, { status: 'complete', expiration: FUTURE }) }).messaging);
        expect(settled.getByTestId('swap-detail-status')).toHaveTextContent('Settled');
        // A settled swap's ring is full, green, with a tick.
        const ring = header(settled).querySelector('[data-fill-ring]');
        expect(ring).toHaveAttribute('data-percent', '100');
        expect(ring).toHaveAttribute('data-mark', 'tick');
        expect(settled.queryByRole('button', action('Cancel swap'))).toBeNull();
        expect(settled.queryByRole('button', action('Edit swap'))).toBeNull();
        expect(within(settled.getByRole('list', { name: 'Swap actions' })).getAllByRole('listitem')).toHaveLength(2);
        cleanup();

        const foreign = await open(harness({ addresses: [{ ...HD_ADDRESS, address: 'nSomeOtherAddress' }] }).messaging);
        expect(foreign.getByTestId('swap-detail-status')).toHaveTextContent('Open');
        expect(foreign.queryByRole('button', action('Cancel swap'))).toBeNull();
    });

    it('says the swap was not found when the detail is not a swap', async () => {
        const utils = await open(harness({ detail: { action: 'ORDER', give_amount: '1' } }).messaging);
        expect(utils.getByText('Swap not found')).toBeTruthy();
        expect(utils.queryByRole('button', action('Cancel swap'))).toBeNull();
    });

    it('makes the same reads for a short history as for a long one', async () => {
        const counts = [];
        for (const size of [1, 40]) {
            const cancels = Array.from({ length: size }, (_, i) => ({
                action_index: String(9000 + i), swap_action_index: String(100 + i), source: OWN, status: 'valid',
            }));
            const lifecycleRows = Array.from({ length: size }, (_, i) => ({
                action_index: String(7000 + i), swap_action_index: '812', block_index: String(67882090 + i),
            }));
            const { messaging, reads } = harness({ cancels, lifecycleRows });
            const utils = await open(messaging);
            expect(utils.getByTestId('swap-detail-status')).toHaveTextContent('Open');
            // The Matches read once their tab is chosen.
            await chooseTab(utils, 'Matches');
            counts.push([...reads].sort());
            cleanup();
        }
        expect(counts[0]).toEqual([
            'getAddressesByChain',
            'getSwapCancelsForAddress',
            'getSwapDetail',
            // The timeline's four lanes: edits, expires, cancels, matches.
            'getSwapLifecycle', 'getSwapLifecycle', 'getSwapLifecycle', 'getSwapLifecycle',
        ]);
        expect(counts[1]).toEqual(counts[0]);
    });

    it('loadSwapDetail reads the swap and its owner cancels once each', async () => {
        const { messaging, reads } = harness({
            cancels: [{ action_index: '9000', swap_action_index: '812', source: OWN, status: 'valid' }],
        });
        const loaded = await loadSwapDetail({ messaging, walletId: 'w', chainId: CHAIN, actionIndex: '812' });
        expect(loaded.item.ownerRecord).toEqual(HD_ADDRESS);
        expect([...loaded.item.cancelledKeys]).toEqual([`${CHAIN}:812`]);
        expect(reads.sort()).toEqual(['getAddressesByChain', 'getSwapCancelsForAddress', 'getSwapDetail']);
    });
});
