// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A swap_cancels row only cancels its swap when the cancel action itself
// is valid. An invalid SWAP cancel leaves the swap open, its row chip Open
// and Cancel offered on its details page; a cancel row with no status (older
// reader) is read as valid.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MySwapsView, collectCancelledKeys } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { SwapDetail } from '../../../packages/core/src/shared/routes/SwapDetail.jsx';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function swapRow(actionIndex) {
    return {
        action_index: String(actionIndex), source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
    };
}

function cancelRow(swapActionIndex, extra = {}) {
    return { action_index: '9000', swap_action_index: String(swapActionIndex), source: OWN, ...extra };
}

function messagingFor(swaps, cancels, { swapsError = null, cancelsError = null } = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSwapsForAddress: () => swapsError
            ? Promise.reject(swapsError)
            : Promise.resolve({ data: swaps }),
        getSwapCancelsForAddress: () => cancelsError
            ? Promise.reject(cancelsError)
            : Promise.resolve({ data: cancels }),
        getSwapDetail: ({ actionIndex }) => Promise.resolve(
            swaps.find((row) => row && typeof row === 'object' && row.action_index === String(actionIndex)) || null,
        ),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    return new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); },
    });
}

async function mount(element, messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging }, element));
        for (let i = 0; i < 24; i += 1) await Promise.resolve();
    });
    return utils;
}

const open = (swaps, cancels, opts) => mount(
    React.createElement(MySwapsView, { walletId: 'w', onBack() {} }),
    messagingFor(swaps, cancels, opts),
);

const openDetail = (swaps, cancels, actionIndex) => mount(
    React.createElement(SwapDetail, { walletId: 'w', chainId: CHAIN, actionIndex: String(actionIndex), onBack() {} }),
    messagingFor(swaps, cancels),
);

afterEach(() => cleanup());

describe('MySwapsView: cancel row status', () => {
    // G91: a failed read shows the plain empty state with no page error or
    // Try Again; the reachability banner reports network trouble once.
    it('shows the plain empty state, never a page error, when the swap feed fails', async () => {
        const utils = await open([], [], { swapsError: new Error('Swap explorer unavailable') });

        expect(utils.getByText('No swaps yet')).toBeTruthy();
        expect(utils.queryByText('Swap explorer unavailable')).toBeNull();
        expect(utils.queryByText('Could not load your swaps. Try again.')).toBeNull();
        expect(utils.queryByRole('button', { name: 'Try Again' })).toBeNull();
    });

    it('lists nothing to act on when the cancellation status feed fails', async () => {
        const utils = await open(
            [swapRow(702)],
            [],
            { cancelsError: new Error('Cancel status unavailable') },
        );

        expect(utils.getByText('No swaps yet')).toBeTruthy();
        expect(utils.queryByText('Cancel status unavailable')).toBeNull();
        expect(utils.queryByRole('list', { name: 'Swaps' })).toBeNull();
    });

    it('an invalid cancel row does not cancel the swap; it stays Open with Cancel offered', async () => {
        const utils = await open([swapRow(700)], [cancelRow(700, { status: 'invalid' })]);
        const list = utils.getByRole('list', { name: 'Swaps' });
        const row = list.querySelector(`[data-swap-row="${CHAIN}:700"]`);
        expect(within(row).getByText('Open')).toBeTruthy();
        // The row holds no actions; Cancel is on the swap's details page.
        expect(within(row).queryByRole('button', { name: 'Cancel Swap' })).toBeNull();
        expect(row).not.toHaveTextContent(/regtest|testnet|Not mainnet/i);
        cleanup();

        const detail = await openDetail([swapRow(700)], [cancelRow(700, { status: 'invalid' })], 700);
        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Open');
        // G101: Cancel is a danger-toned action row that says what it returns.
        const cancel = detail.getByRole('button', { name: /^Cancel swap/ });
        expect(cancel).toHaveTextContent('Returns the 500 DOGESWAP still escrowed');
        expect(cancel.getAttribute('data-tone')).toBe('danger');
    });

    it('a valid cancel row shows the swap as Cancelled with no Cancel', async () => {
        const utils = await open([swapRow(701)], [cancelRow(701, { status: 'valid' })]);
        const row = utils.getByRole('list', { name: 'Swaps' }).querySelector(`[data-swap-row="${CHAIN}:701"]`);
        expect(within(row).getByText('Closed')).toBeTruthy();
        expect(within(row).queryByText('Cancelled')).toBeNull();
        expect(row.querySelector('[data-fill-ring]').getAttribute('data-column')).toBe('fit');
        // A cancelled swap's ring shows a cross on a grey ring.
        const ring = row.querySelector('[data-fill-ring]');
        expect(ring.getAttribute('data-mark')).toBe('cross');
        expect(ring.getAttribute('data-tone')).toBe('muted');
        cleanup();

        const detail = await openDetail([swapRow(701)], [cancelRow(701, { status: 'valid' })], 701);
        expect(detail.getByTestId('swap-detail-status')).toHaveTextContent('Closed');
        expect(detail.queryByRole('button', { name: /^Cancel swap/ })).toBeNull();
        expect(detail.queryByRole('button', { name: /^Edit swap/ })).toBeNull();
    });

    it('collectCancelledKeys skips invalid, keeps valid and status-less, and ignores foreign sources', () => {
        const results = [{
            p: { chainId: CHAIN, owner: { address: OWN } },
            cancels: [
                cancelRow(1, { status: 'invalid' }),
                cancelRow(2, { status: 'valid' }),
                cancelRow(3),
                cancelRow(4, { status: 'valid', source: 'someoneElse' }),
            ],
        }];
        expect([...collectCancelledKeys(results)].sort()).toEqual([`${CHAIN}:2`, `${CHAIN}:3`]);
    });

    it('shows plain copy and blocks a non-canonical swap action ID before compose', async () => {
        const utils = await openDetail([swapRow('007')], [], '007');

        fireEvent.click(utils.getByRole('button', { name: /^Cancel swap/ }));

        expect(utils.getByText('This swap has an invalid action ID and cannot be changed.')).toBeTruthy();
        // G22: the submit stays pressable; pressing it names the problem and composes nothing.
        const submit = utils.getByRole('button', { name: 'Cancel Swap' });
        expect(submit.disabled).toBe(false);
        fireEvent.click(submit);
        expect(utils.getAllByText('This swap has an invalid action ID and cannot be changed.').length).toBeGreaterThanOrEqual(1);
        expect(utils.getByRole('button', { name: 'Cancel Swap' })).toBeTruthy();
    });

    it('keeps valid swaps usable when explorer arrays contain malformed rows', async () => {
        const utils = await open(
            [null, 17, swapRow(750), swapRow(750)],
            [null, 'bad-row'],
        );

        expect(utils.queryByText('Could not load your swaps. Try again.')).toBeNull();
        const list = utils.getByRole('list', { name: 'Swaps' });
        expect(list.querySelectorAll(`[data-swap-row="${CHAIN}:750"]`)).toHaveLength(1);
        expect(within(list).getAllByText('Swap 500 DOGESWAP')).toHaveLength(1);
    });
});
