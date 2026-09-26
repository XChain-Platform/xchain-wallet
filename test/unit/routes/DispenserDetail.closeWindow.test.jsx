// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A cancelled dispenser sits in a 1-hour close window before its escrow
// returns. The dispenser record names who closed it but not when, so the
// banner dates the window from the cancel row the Lifecycle tab loads, counts
// down while mounted, and sends the escrow to whichever address closed it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'litecoin-regtest';
const CREATOR = 'rltc1qcreatorcreatorcreatorcreatorcreatorcrea';
const DISPENSER_ADDRESS = 'rltc1qdispenserdispenserdispenserdispensdisp';
const CANCEL_AT = 1790455620;

const CREATOR_ADDRESS = Object.freeze({
    id: 'addr-creator', address: CREATOR, publicKey: '02aa', derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const STRANGER_ADDRESS = Object.freeze({
    id: 'addr-other', address: 'rltc1qstrangerstrangerstrangerstrangerstra', publicKey: '02bb',
    derivationPath: "m/84'/2'/0'/0/3", source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});

// The by-action-index shape for a BEER dispenser in its close window:
// `state.status` is cancelling and `cancelled_by` names the closer.
const CLOSING = Object.freeze({
    action_index: '18',
    source: CREATOR,
    get_address: DISPENSER_ADDRESS,
    give_tick: 'BEER',
    give_amount: '1',
    give_escrow: '12',
    give_ownership: 0,
    get_coin: 'LTC',
    get_tick: null,
    get_amount: '0.001',
    status: 'valid',
    cancelled_by: CREATOR,
    state: { status: 'cancelling', give_remaining: '12', expiration: null, allow_list: null, block_list: null },
});

const CANCEL_ROW = Object.freeze({
    action: 'DISPENSER_CANCEL', action_index: '19', action_format: 1, dispenser_action_index: '18',
    source: CREATOR, block_index: 500, timestamp: CANCEL_AT, status: 'valid',
});

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
    // 37 minutes into the window: 23 minutes to the earliest close.
    vi.setSystemTime((CANCEL_AT + 37 * 60) * 1000);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function drainMicrotasks(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function stubMessaging({ dispenser, walletAddress, cancelsByAddress }) {
    const lifecycleCalls = [];
    const target = {
        getDispenserByActionIndex: () => Promise.resolve(dispenser),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [walletAddress] }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: () => Promise.resolve({ data: [] }),
        getDispenserLifecycle: (req) => {
            lifecycleCalls.push(req);
            if (req.kind !== 'cancels') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: cancelsByAddress[req.query] || [] });
        },
        getWalletBalances: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getListByActionIndex: () => Promise.resolve(null),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, lifecycleCalls };
}

async function mount({ dispenser = CLOSING, walletAddress = CREATOR_ADDRESS, cancelsByAddress = { [CREATOR]: [CANCEL_ROW] } } = {}) {
    const { messaging, lifecycleCalls } = stubMessaging({ dispenser, walletAddress, cancelsByAddress });
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: dispenser.action_index,
                onBack() {}, onCanceled() {}, onOpenAgain() {},
            }),
        ));
        await drainMicrotasks();
    });
    return { utils, lifecycleCalls };
}

const banner = (utils) => utils.getByTestId('close-window-banner').textContent;
const clockOf = (unixSeconds) => new Date(unixSeconds * 1000)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

describe('DispenserDetail close-window banner', () => {
    it('counts down to the earliest close, names the escrow and says it returns to this wallet', async () => {
        const { utils } = await mount();
        expect(banner(utils)).toBe(
            `Closing in about 23 minutes (around ${clockOf(CANCEL_AT + 3600)}). `
            + 'This dispenser is in its 1-hour close window; the remaining 12 BEER in escrow returns to '
            + 'this wallet with the first block after it ends. '
            + 'Dispenses that confirm before the close are still honored.',
        );
    });

    it('updates the countdown each minute while mounted and stops its timer on unmount', async () => {
        const { utils } = await mount();
        await domAct(async () => { vi.advanceTimersByTime(10 * 60 * 1000); await drainMicrotasks(); });
        expect(banner(utils)).toMatch(/^Closing in about 13 minutes/);
        const clearSpy = vi.spyOn(globalThis, 'clearInterval');
        utils.unmount();
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });

    it('says "any block now" once the window has passed', async () => {
        vi.setSystemTime((CANCEL_AT + 3600 + 90) * 1000);
        const { utils } = await mount();
        expect(banner(utils)).toBe(
            'Closing any block now: the 1-hour close window has passed and the close lands with the next block. '
            + 'The remaining 12 BEER in escrow returns to this wallet. '
            + 'Dispenses that confirm before the close are still honored.',
        );
    });

    it('sends the escrow to the dispenser address when that address closed it, reading its cancel there', async () => {
        const { utils, lifecycleCalls } = await mount({
            dispenser: { ...CLOSING, cancelled_by: DISPENSER_ADDRESS },
            walletAddress: STRANGER_ADDRESS,
            cancelsByAddress: { [DISPENSER_ADDRESS]: [{ ...CANCEL_ROW, source: DISPENSER_ADDRESS }] },
        });
        expect(lifecycleCalls).toContainEqual({ chainId: CHAIN, kind: 'cancels', query: DISPENSER_ADDRESS, type: 'address' });
        expect(banner(utils)).toMatch(/^Closing in about 23 minutes/);
        expect(banner(utils)).toContain('returns to rltc1q…disp with the first block');
        expect(banner(utils)).not.toContain('this wallet');
        expect(banner(utils)).not.toContain('owner');
    });

    it('keeps a time-free sentence when the cancel time cannot be read', async () => {
        const { utils } = await mount({ cancelsByAddress: {} });
        expect(banner(utils)).toBe(
            'Closing: this dispenser is in its 1-hour close window. '
            + 'The remaining 12 BEER in escrow returns to this wallet when the window ends. '
            + 'Dispenses that confirm before the close are still honored.',
        );
    });

    it('ignores a refused cancel when dating the window', async () => {
        const { utils } = await mount({ cancelsByAddress: { [CREATOR]: [{ ...CANCEL_ROW, status: 'invalid: not open' }] } });
        expect(banner(utils)).toMatch(/^Closing: this dispenser is in its 1-hour close window\./);
    });

    it('shows no banner on an open dispenser', async () => {
        const { utils } = await mount({
            dispenser: { ...CLOSING, cancelled_by: null, state: { ...CLOSING.state, status: 'open' } },
        });
        expect(utils.queryByTestId('close-window-banner')).toBeNull();
    });
});
