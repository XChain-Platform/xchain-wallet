// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet issue #50: a cross-chain LINK only threaded on the chain it was
// broadcast on. The protocol records a LINK on the broadcasting side only
// (xchain-documentation/protocol/actions/link.md), so `getLinksForAddress`
// on the OTHER chain never returns a row for it. History's `linkMap` used to
// key only the local side of `sidesFromLink`, so the peer action's row (same
// wallet, same History list) rendered with no badge and no detail reference,
// even though the Link form promises both sides thread together.
//
// These drive the real History route (not the helpers in isolation), since
// the bug lived in how `linkMap` was populated from `perAddrResults`, not in
// `sidesFromLink` or `historyGrouping` themselves.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const GROUPING_MODE_STORAGE_KEY = 'xc:historyGroupingMode';
const BTC_CHAIN = 'bitcoin-testnet';
const DOGE_CHAIN = 'dogecoin-testnet';
const BTC_ADDR = 'tb1ql64k7xxxxxxxxxxxxxxxxxxxxxxxxe38nnl';
const DOGE_ADDR = 'nDNNBSxxxxxxxxxxxxxxxxxxxxxxxxxxRacsnH';

/** Recent, because History's default date window is the last 30 days. */
const NOW_S = Math.floor(Date.now() / 1000);

function stakeRow(actionIndex, source, secondsAgo) {
    return {
        action: 'STAKE',
        action_index: String(actionIndex),
        block_index: 153500,
        timestamp: NOW_S - secondsAgo,
        tx_hash: `stakehash${actionIndex}`,
        source,
    };
}

/** A LINK row exactly as the explorer's `getLinksForAddress` publishes it. */
function linkRow({ actionIndex, coin1, coin1ActionIndex, coin2, coin2ActionIndex, source }) {
    return {
        action: 'LINK',
        action_index: String(actionIndex),
        coin1,
        coin1_action_index: String(coin1ActionIndex),
        coin2,
        coin2_action_index: String(coin2ActionIndex),
        block_index: 153587,
        tx_hash: `linkhash${actionIndex}`,
        source,
    };
}

/**
 * Mounts History over N chains, each with its own history/links fixture.
 * `chainOrder` controls the key order `getAddressesByChain` resolves with,
 * which is what decides the order `perAddrResults` lands in.
 */
function mountHistoryMultiChain(chainOrder, chainData, { onSelectEntry } = {}) {
    const addressesByChain = Object.fromEntries(
        chainOrder.map((cid) => [cid, [{ address: chainData[cid].address }]]),
    );
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(addressesByChain),
        getAddressHistory: vi.fn(({ chainId }) => Promise.resolve(chainData[chainId].history || [])),
        getLinksForAddress: vi.fn(({ chainId }) => Promise.resolve(chainData[chainId].links || [])),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, {
                walletId: 'w1', accountId: 'a1', onSelectEntry,
            }),
        ),
    );
    return { messaging, view };
}

/** Every top-level History row's `data-history-key`. */
function rowKeys(view) {
    return [...view.container.querySelectorAll('[data-history-key]')]
        .map((el) => el.getAttribute('data-history-key'));
}

function clickRow(view, key) {
    const button = view.container.querySelector(`[data-history-key="${key}"] button`);
    expect(button, `no rendered row for ${key}`).toBeTruthy();
    fireEvent.click(button);
}

/**
 * Grouped is the default mode, and a genuine two-sided pair (both rows
 * sharing one `linkActionIndex`) collapses into a single "Cross-chain"
 * card by design (`historyGrouping.js`'s `linkPairLeaders`). Flat mode
 * un-collapses it so a test can assert on each side's own row.
 */
async function switchToFlatMode() {
    const radio = await screen.findByRole('radio', { name: 'Flat' });
    fireEvent.click(radio);
    await waitFor(() => expect(radio.getAttribute('aria-checked')).toBe('true'));
}

beforeEach(() => {
    // Grouped is the persisted default; clear so an earlier test's Flat
    // click (jsdom's localStorage survives across tests in one file) can't
    // decide the next test's starting mode.
    try { globalThis.localStorage?.removeItem(GROUPING_MODE_STORAGE_KEY); } catch { /* jsdom */ }
});
afterEach(() => cleanup());

describe('History threads a cross-chain LINK onto both sides (issue #50)', () => {
    it('BTC STAKE #320 and DOGE STAKE #1793 both carry the link, sharing linkActionIndex', async () => {
        const link = linkRow({
            actionIndex: 326, coin1: 'BTC', coin1ActionIndex: 320, coin2: 'DOGE', coin2ActionIndex: 1793, source: BTC_ADDR,
        });
        const seen = [];
        const { view } = mountHistoryMultiChain([BTC_CHAIN, DOGE_CHAIN], {
            [BTC_CHAIN]: { address: BTC_ADDR, history: [stakeRow(320, BTC_ADDR, 60)], links: [link] },
            // No LINK ever broadcasts on DOGE for this pair, matching the
            // protocol (LINK is recorded on the broadcasting side only).
            [DOGE_CHAIN]: { address: DOGE_ADDR, history: [stakeRow(1793, DOGE_ADDR, 90)], links: [] },
        }, { onSelectEntry: (entry) => seen.push(entry) });

        // Both sides share one linkActionIndex, so Grouped mode (the
        // default) collapses them into one "Cross-chain" card; switch to
        // Flat to assert on each side's own row, same as the badge titles
        // and the detail card read them.
        await switchToFlatMode();
        await waitFor(() => expect(rowKeys(view)).toEqual(expect.arrayContaining([
            `${BTC_CHAIN}:320:${BTC_ADDR}`,
            `${DOGE_CHAIN}:1793:${DOGE_ADDR}`,
        ])));

        // The BTC row's own on-chain LINK record (unaffected by the fix).
        expect(screen.getByTitle('Linked to DOGE #1793')).toBeTruthy();
        // The DOGE row: this is the peer that had no badge before the fix,
        // since no LINK row was ever broadcast from the DOGE side.
        expect(screen.getByTitle('Linked to BTC #320')).toBeTruthy();

        clickRow(view, `${BTC_CHAIN}:320:${BTC_ADDR}`);
        clickRow(view, `${DOGE_CHAIN}:1793:${DOGE_ADDR}`);
        expect(seen).toHaveLength(2);
        const btcEntry = seen.find((e) => e.chainId === BTC_CHAIN);
        const dogeEntry = seen.find((e) => e.chainId === DOGE_CHAIN);

        expect(btcEntry.link.peerChainId).toBe(DOGE_CHAIN);
        expect(btcEntry.link.peerCoinTicker).toBe('DOGE');
        expect(btcEntry.link.peerActionIndex).toBe('1793');

        expect(dogeEntry.link.peerChainId).toBe(BTC_CHAIN);
        expect(dogeEntry.link.peerCoinTicker).toBe('BTC');
        expect(dogeEntry.link.peerActionIndex).toBe('320');

        expect(dogeEntry.link.linkActionIndex).toBe(btcEntry.link.linkActionIndex);
        expect(btcEntry.link.linkActionIndex).toBe('326');
    });

    it('does not crash and grows no phantom peer badge when the wallet holds no address on the peer chain', async () => {
        const link = linkRow({
            actionIndex: 326, coin1: 'BTC', coin1ActionIndex: 320, coin2: 'DOGE', coin2ActionIndex: 1793, source: BTC_ADDR,
        });
        const { view } = mountHistoryMultiChain([BTC_CHAIN], {
            [BTC_CHAIN]: { address: BTC_ADDR, history: [stakeRow(320, BTC_ADDR, 60)], links: [link] },
        });

        await waitFor(() => expect(rowKeys(view)).toEqual([`${BTC_CHAIN}:320:${BTC_ADDR}`]));
        // BTC's own LINK record still threads normally.
        expect(screen.getByTitle('Linked to DOGE #1793')).toBeTruthy();
        // No DOGE row exists to carry a peer badge: the wallet never fetched
        // that chain, so the dangling peer map entry is simply never looked up.
        expect(screen.queryByTitle('Linked to BTC #320')).toBeNull();
    });

    it.each([
        ['BTC first', [BTC_CHAIN, DOGE_CHAIN]],
        ['DOGE first', [DOGE_CHAIN, BTC_CHAIN]],
    ])('a LINK broadcast on both chains: each side keeps its own record (%s)', async (label, chainOrder) => {
        const seen = [];
        const { view } = mountHistoryMultiChain(chainOrder, {
            [BTC_CHAIN]: {
                address: BTC_ADDR,
                history: [stakeRow(320, BTC_ADDR, 60)],
                links: [linkRow({
                    actionIndex: 326, coin1: 'BTC', coin1ActionIndex: 320, coin2: 'DOGE', coin2ActionIndex: 1793, source: BTC_ADDR,
                })],
            },
            [DOGE_CHAIN]: {
                address: DOGE_ADDR,
                history: [stakeRow(1793, DOGE_ADDR, 90)],
                links: [linkRow({
                    actionIndex: 999, coin1: 'DOGE', coin1ActionIndex: 1793, coin2: 'BTC', coin2ActionIndex: 320, source: DOGE_ADDR,
                })],
            },
        }, { onSelectEntry: (entry) => seen.push(entry) });

        await waitFor(() => expect(rowKeys(view)).toEqual(expect.arrayContaining([
            `${BTC_CHAIN}:320:${BTC_ADDR}`,
            `${DOGE_CHAIN}:1793:${DOGE_ADDR}`,
        ])));

        clickRow(view, `${BTC_CHAIN}:320:${BTC_ADDR}`);
        clickRow(view, `${DOGE_CHAIN}:1793:${DOGE_ADDR}`);
        const btcEntry = seen.find((e) => e.chainId === BTC_CHAIN);
        const dogeEntry = seen.find((e) => e.chainId === DOGE_CHAIN);

        // Own-chain LINK wins regardless of which chain's perAddrResults
        // entry the loop reaches first: BTC's record names LINK #326, and a
        // buggy "last write wins" map would let DOGE's #999 clobber it (or
        // vice versa) depending on iteration order.
        expect(btcEntry.link.linkActionIndex).toBe('326');
        expect(dogeEntry.link.linkActionIndex).toBe('999');
    });
});
