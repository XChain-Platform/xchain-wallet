// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Driven through the RENDERED History route instead of through the
// helpers it calls.
//
// The fix (`5bd99f09`) lifts the per-action fields the explorer nests under
// `details` up beside the row's own, and `historyRowDetails.test.js` already
// pins the helper and the two consumers in isolation. What none of that shows
// is the thing the operator was promised: that a real wallet, handed the row
// shape the explorer actually publishes, GROUPS in Grouped mode and NARROWS
// when the tick is typed into the search box. Those two live behind
// `History.jsx`'s own ingestion (`normalizeHistoryRow`), its date window, its
// grouping-mode toggle and its filter bar, and a helper test reaches none of
// them.
//
// WHY THE FIXTURE IS AN ISSUE PLUS **TWO** MINTS. `groupHistoryEntries`
// suppresses a single-child group on purpose (`minMembers = 2`, counted over
// MEMBERS, which excludes the leader), so an ISSUE with one MINT renders as two
// flat rows on a WORKING build and on a broken one alike. A one-mint fixture
// cannot tell the two apart, which is why the committed History specs stayed
// green through the whole life of the defect. Two mints is the smallest fixture
// that can fail.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. Every row below carries its
// tick, source and amount ONLY under `details`, exactly as
// `projectActionSummary` (xchain-explorer `src/db.js`) publishes them - nothing
// is pre-flattened for the wallet's convenience. So the grouping claim can only
// pass if the lift ran at ingestion, and the search claim can only pass if the
// lifted tick reached `historyFilter`'s payload search. Falsified by deleting
// the `flattenActionDetails` call in `normalizeHistoryRow`: the grouped, flat
// and search claims all redden, while the fourth test (which pins the
// suppression rule and is independent of the lift) stays green.
//
// The unrelated SEND row exists so the search claim is not vacuous: a query
// that "narrows" a list of three matching rows to three matching rows proves
// nothing. It is a different tick, so the tick query must drop it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const TICK = 'CAMPA';
const OTHER_TICK = 'XCHAIN';
const GROUPING_MODE_STORAGE_KEY = 'xc:historyGroupingMode';

/** Recent, because History's default date window is the last 30 days. */
const NOW_S = Math.floor(Date.now() / 1000);

/**
 * A history row in the explorer's OWN shape: identity and status at the top
 * level, every per-action field under `details`. Nothing here is flattened -
 * that is the point of the fixture.
 */
function explorerRow(action, actionIndex, details, secondsAgo) {
    return {
        action,
        action_index: String(actionIndex),
        block_index: 7800 + Number(actionIndex),
        timestamp: NOW_S - secondsAgo,
        tx_hash: `deadbeef${actionIndex}`,
        status: 'valid',
        details: { action_format: 0, action_index: String(actionIndex), ...details },
    };
}

/** ISSUE first, then two MINTs of the same tick from the same source. */
const ISSUE = explorerRow('ISSUE', 4001, { tick: TICK, source: OURS, amount: '1000' }, 900);
const MINT_1 = explorerRow('MINT', 4002, { tick: TICK, source: OURS, amount: '150' }, 600);
const MINT_2 = explorerRow('MINT', 4003, { tick: TICK, source: OURS, amount: '150' }, 300);
/** A row that must NOT match a search for the issued tick. */
const OTHER_SEND = explorerRow('SEND', 4010, {
    tick: OTHER_TICK, source: OURS, amount: '25', destination: 'rltc1qdest0000',
}, 120);

const LAUNCH_FIXTURE = [OTHER_SEND, MINT_2, MINT_1, ISSUE];

function mountHistory(history) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
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
            React.createElement(History, { walletId: 'w1', accountId: 'a1' }),
        ),
    );
    return { messaging, view };
}

/**
 * Every top-level History ROW. A collapsed group card is a `<li>` WITHOUT a
 * `data-history-key`, so this counts rows and never group cards - which is
 * what makes "the three actions collapsed" observable as a count.
 */
function rowKeys(view) {
    return [...view.container.querySelectorAll('[data-history-key]')]
        .map((el) => el.getAttribute('data-history-key'));
}

/** The collapsed Launch card, if History drew one. */
function launchCard() {
    return screen.queryByRole('button', { name: /Launched/ });
}

function setSearch(value) {
    fireEvent.change(screen.getByLabelText('Search history'), { target: { value } });
}

async function clickGroupingMode(name) {
    fireEvent.click(screen.getByRole('radio', { name }));
    await waitFor(() => expect(screen.getByRole('radio', { name }).getAttribute('aria-checked'))
        .toBe('true'));
}

/** Waits until History has ingested the fixture and drawn something for it. */
async function waitForHistory(view) {
    await waitFor(() => expect(view.container.textContent).toContain('Send'), { timeout: 10_000 });
}

beforeEach(() => {
    // Grouped is the default for a wallet that has never chosen, and jsdom's
    // localStorage survives between tests in the same file; a previous test's
    // Flat click would otherwise decide the next test's starting mode.
    try { globalThis.localStorage?.removeItem(GROUPING_MODE_STORAGE_KEY); } catch { /* jsdom */ }
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('History collapses an ISSUE and its two MINTs', () => {
    it('GROUPED: the three actions render as one Launch card, not three rows', async () => {
        const { view } = mountHistory(LAUNCH_FIXTURE);
        await waitForHistory(view);

        // Grouped is the persisted default and this store was just cleared.
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Grouped' })
            .getAttribute('aria-checked')).toBe('true'));

        const card = await waitFor(() => {
            const el = launchCard();
            expect(el, 'the ISSUE and its two MINTs never collapsed into a Launch card, which is '
                + 'what Grouped mode looks like when the explorer\'s nested tick never reaches '
                + 'the grouper').toBeTruthy();
            return el;
        }, { timeout: 10_000 });

        // The summary names the tick the explorer published under `details`,
        // so the card is about THIS launch and not merely a card.
        expect(card.textContent, 'the Launch card does not name the issued tick')
            .toContain(`Launched ${TICK}`);
        // Leader plus both mints. A card that said 2 would mean one mint had
        // been left loose.
        expect(within(card).getByText('3'), 'the Launch card does not count all three actions')
            .toBeTruthy();

        // The only loose row left is the unrelated SEND: the three grouped
        // actions are inside the collapsed card, not beside it.
        expect(rowKeys(view), 'a grouped action is still rendering as its own row')
            .toEqual([`${CHAIN}:4010:${OURS}`]);
    });

    it('FLAT: the same three actions are three separate rows, and Grouped takes them back', async () => {
        // The toggle is the claim, so both halves are asserted in one walk: a
        // build that grouped nothing would show these four rows under BOTH
        // modes and look identical to a working one from the Flat side alone.
        const { view } = mountHistory(LAUNCH_FIXTURE);
        await waitForHistory(view);
        await waitFor(() => expect(launchCard(),
            'Grouped mode drew no Launch card, so there is nothing for Flat to unfold')
            .toBeTruthy(), { timeout: 10_000 });

        await clickGroupingMode('Flat');

        expect(launchCard(), 'Flat mode still drew a group card').toBeNull();
        expect(rowKeys(view), 'Flat mode did not render every action as its own row').toEqual([
            `${CHAIN}:4010:${OURS}`,
            `${CHAIN}:4003:${OURS}`,
            `${CHAIN}:4002:${OURS}`,
            `${CHAIN}:4001:${OURS}`,
        ]);

        await clickGroupingMode('Grouped');
        expect(launchCard(), 'coming back to Grouped mode lost the Launch card').toBeTruthy();
        expect(rowKeys(view), 'coming back to Grouped mode left the launch actions loose')
            .toEqual([`${CHAIN}:4010:${OURS}`]);
    });

    it('SEARCH: typing the issued tick narrows the list to that launch', async () => {
        const { view } = mountHistory(LAUNCH_FIXTURE);
        await waitForHistory(view);
        await clickGroupingMode('Flat');
        expect(rowKeys(view)).toHaveLength(4);

        // The tick lives ONLY under `details` on every fixture row, so a match
        // here is proof the payload search sees the lifted field. Before the
        // fix this query returned nothing at all.
        setSearch(TICK);
        await waitFor(() => expect(rowKeys(view),
            'searching the issued tick did not narrow the list to its own actions').toEqual([
            `${CHAIN}:4003:${OURS}`,
            `${CHAIN}:4002:${OURS}`,
            `${CHAIN}:4001:${OURS}`,
        ]));

        // Case-insensitive, and a tick nobody issued matches nothing - so the
        // narrowing above is the filter working, not the list re-rendering.
        setSearch(TICK.toLowerCase());
        await waitFor(() => expect(rowKeys(view)).toHaveLength(3));

        setSearch('NOSUCHTICK');
        await waitFor(() => expect(rowKeys(view),
            'a search that matches nothing still left rows on screen').toHaveLength(0));

        setSearch('');
        await waitFor(() => expect(rowKeys(view), 'clearing the search did not restore the list')
            .toHaveLength(4));
    });

    it('SEARCH under GROUPED: the tick query keeps the Launch card and drops the rest', async () => {
        const { view } = mountHistory(LAUNCH_FIXTURE);
        await waitForHistory(view);
        await waitFor(() => expect(launchCard()).toBeTruthy(), { timeout: 10_000 });

        setSearch(TICK);
        // The unrelated SEND is the only loose row, and it does not carry this
        // tick, so a working search leaves the card alone on screen.
        await waitFor(() => expect(rowKeys(view),
            'the unrelated action survived a search for another token\'s tick').toHaveLength(0));
        expect(launchCard(), 'searching the issued tick dropped its own Launch card').toBeTruthy();
    });

    it('an ISSUE with ONE mint stays flat, which is why this fixture needs two', async () => {
        // Not a restatement of the defect: single-child groups are suppressed
        // deliberately (`minMembers = 2`). Pinned here so a future reader who
        // trims the fixture to save a row learns why the suite stopped being
        // able to fail, instead of rediscovering it as a mystery.
        const { view } = mountHistory([OTHER_SEND, MINT_1, ISSUE]);
        await waitForHistory(view);
        await waitFor(() => expect(rowKeys(view)).toHaveLength(3), { timeout: 10_000 });
        expect(launchCard(), 'a single-mint launch must not collapse into a card').toBeNull();
    });
});
