// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A swap_cancels row only cancels its swap when the cancel action itself
// is valid. An invalid SWAP cancel leaves the swap open with live buttons;
// a cancel row with no status (older reader) is read as valid.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MySwapsView, collectCancelledKeys } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';

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

async function open(swaps, cancels) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSwapsForAddress: () => Promise.resolve({ data: swaps }),
        getSwapCancelsForAddress: () => Promise.resolve({ data: cancels }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); },
    });
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(MySwapsView, { walletId: 'w', onBack() {} })));
        for (let i = 0; i < 24; i += 1) await Promise.resolve();
    });
    return utils;
}

afterEach(() => cleanup());

describe('MySwapsView: cancel row status', () => {
    it('an invalid cancel row does not cancel the swap; it stays Open with Cancel offered', async () => {
        const utils = await open([swapRow(700)], [cancelRow(700, { status: 'invalid' })]);
        const list = utils.queryByRole('list', { name: 'Open swaps' });
        expect(list).not.toBeNull();
        expect(utils.queryByRole('list', { name: 'Closed swaps' })).toBeNull();
        const row = within(list).getByText('#700', { exact: false }).closest('li');
        expect(within(row).getByText('Open')).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('a valid cancel row files the swap under Closed as Cancelled', async () => {
        const utils = await open([swapRow(701)], [cancelRow(701, { status: 'valid' })]);
        const list = utils.queryByRole('list', { name: 'Closed swaps' });
        const row = within(list).getByText('#701', { exact: false }).closest('li');
        expect(within(row).getByText('Cancelled')).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'Cancel' })).toBeNull();
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
});
