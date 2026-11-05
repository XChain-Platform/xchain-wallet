// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The swap Cancel and Edit panel's wrap() is a bare Screen. The broadcast
// result (title, explainer, transaction ID and Done) lays out through a
// ListPage inside that Screen, the same as the list states and the form
// step's FormPage, so it never draws straight into the Screen content box.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, within } from '@testing-library/react';

const { ownerRun } = vi.hoisted(() => ({ ownerRun: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({
        open: false,
        composing: false,
        isWatcherMode: false,
        confirmProps: {},
        run: ownerRun,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { ListPage } from '../../../packages/core/src/ui/index.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const TXID = 'c'.repeat(64);

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

const SWAP_ROW = Object.freeze({
    action_index: '812', source: OWN,
    give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
    get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
    expiration: FUTURE, block_index: '67882087', status: 'valid',
});

function listPageClass() {
    const probe = render(<ListPage><p>x</p></ListPage>);
    const name = probe.container.firstChild.className.split(' ')[0];
    probe.unmount();
    return name;
}

async function flush(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

async function openCancelResult() {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSwapsForAddress: () => Promise.resolve({ data: [SWAP_ROW] }),
        getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); },
    });
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MySwapsView walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await flush();
    });
    const list = utils.getByRole('list', { name: 'Open swaps' });
    const row = within(list).getByText('#812', { exact: false }).closest('li');
    await domAct(async () => {
        fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
        await flush();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Cancel swap' }));
        await flush();
    });
    return utils;
}

afterEach(() => {
    cleanup();
    ownerRun.mockReset();
});

describe('MySwapsView: the swap action broadcast result renders inside ListPage', () => {
    it('lays out the cancel broadcast title, transaction ID and Done inside a ListPage within the Screen', async () => {
        ownerRun.mockResolvedValue({ txid: TXID });
        const { container, getByText, getByRole } = await openCancelResult();

        expect(ownerRun).toHaveBeenCalledTimes(1);
        const title = getByText('Cancel broadcast');
        const page = title.closest(`.${CSS.escape(listPageClass())}`);
        expect(page, 'broadcast title inside ListPage').not.toBeNull();
        expect(page.parentElement, 'ListPage is not the Screen root').not.toBe(container);
        expect(page.contains(getByText(TXID))).toBe(true);
        expect(page.contains(getByRole('button', { name: 'Done' }))).toBe(true);
    });
});
