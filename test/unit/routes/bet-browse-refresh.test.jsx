// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-117: the betting hub used to read the chain once and never again.
//
// FOUND BY DRIVING IT, not by reading it. A live regtest run (campaign §10.1)
// opened a market, let its deadline pass, mined the block that latched it
// `closed`, and then watched the wallet keep it under "Taking bets". The trace
// settled what the screenshot could not: SIX list requests in the whole run,
// all inside the first thirty seconds, and none after the market closed
// minutes later. Re-selecting "Betting" from the command palette did not help
// either - the route was already mounted, so no effect re-ran.
//
// WHY IT IS WORTH A TEST RATHER THAN A ONE-LINE FIX. The status of a market
// changes with no user action at all: a deadline passes, an oracle resolves, a
// new market opens. A list that never re-reads is therefore wrong by default
// on any screen left open, and "wrong" here means telling someone a market is
// taking bets when the chain has closed it. The three properties below are the
// ones a naive refresh gets wrong, and each fails against the pre-fix code:
//
//   1. it must re-read on a timer (the defect itself);
//   2. it must NOT blank the list to do it, or the whole screen flashes
//      "Loading markets…" every 30 seconds;
//   3. a refresh that FAILS must leave the markets on screen rather than
//      replacing them with an error - the rows are still the best thing known
//      about the chain, and a blip is not news.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function market(index, status) {
    return {
        action_index: String(index),
        source: OWN,
        label: `Market ${index}`,
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        feed_status: status,
        deadline: Math.floor(Date.now() / 1000) + 3600,
    };
}

/**
 * A messaging stub whose market list can change between reads, which is the
 * whole point: the chain moves while the screen stays still.
 */
function harness(responses) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        betFeeds: (req) => {
            calls.push(req);
            const next = responses[Math.min(calls.length - 1, responses.length - 1)];
            return typeof next === 'function' ? next() : Promise.resolve({ data: next });
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function renderList(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(BetFeedsList, {
                walletId: 'w', onOpenMarket() {}, onBack() {},
            }),
        ));
        await drain();
    });
    return utils;
}

async function tick(ms) {
    await domAct(async () => {
        vi.advanceTimersByTime(ms);
        await drain();
    });
}

describe('BetFeedsList refresh', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks(); });

    it('re-reads the chain while it is on screen, so a market that closes leaves the list', async () => {
        const { messaging, calls } = harness([
            [market(1252, 'open'), market(1248, 'open')],
            [market(1248, 'open')],
        ]);
        const { container } = await renderList(messaging);
        expect(container.textContent).toContain('#1252');
        const before = calls.length;

        await tick(30_000);

        expect(calls.length,
            'the list never re-read the chain: a market that closes stays under "Taking bets"')
            .toBeGreaterThan(before);
        expect(container.textContent,
            'the closed market is still listed after a refresh that no longer returns it')
            .not.toContain('#1252');
        expect(container.textContent).toContain('#1248');
    });

    it('does not blank the list to refresh it', async () => {
        // The refresh is held OPEN deliberately. A stub that resolves
        // immediately cannot see this defect at all: `act` drains the
        // microtask queue before the assertion runs, so the list is already
        // repopulated and a version that blanks it looks identical to one that
        // does not. Verified: with an immediate stub, this test passes against
        // a refresh that clears the rows.
        let release;
        const held = new Promise((resolve) => { release = resolve; });
        const { messaging } = harness([
            [market(1248, 'open')],
            () => held.then(() => ({ data: [market(1248, 'open')] })),
        ]);
        const { container } = await renderList(messaging);
        expect(container.textContent).not.toContain('Loading markets');

        await tick(30_000);   // the refresh is now in flight and unresolved
        expect(container.textContent,
            'the whole list flashes "Loading markets…" on every refresh')
            .not.toContain('Loading markets');
        expect(container.textContent,
            'the markets vanish while the refresh is in flight')
            .toContain('#1248');

        release();
        await domAct(async () => { await drain(); });
        expect(container.textContent).toContain('#1248');
    });

    it('keeps the markets on screen when a refresh fails', async () => {
        const { messaging } = harness([
            [market(1248, 'open')],
            () => Promise.reject(new Error('explorer unreachable')),
        ]);
        const { container } = await renderList(messaging);
        expect(container.textContent).toContain('#1248');

        await tick(30_000);

        expect(container.textContent,
            'a failed refresh threw away markets that were still the best thing known')
            .toContain('#1248');
        expect(container.textContent,
            'a momentary refresh failure is reported as if the screen had nothing')
            .not.toContain('explorer unreachable');
    });

    it('stops refreshing once the screen is gone', async () => {
        const { messaging, calls } = harness([[market(1248, 'open')]]);
        const { unmount } = await renderList(messaging);
        const before = calls.length;

        unmount();
        await tick(90_000);

        expect(calls.length, 'the timer outlived the route and kept polling the explorer')
            .toBe(before);
    });
});
