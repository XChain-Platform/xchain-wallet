// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home under a rate limit (rate-limits spec, M4).
//
// THE SHAPE THIS DRIVES, and it is not the obvious one: `flows/balances.js`
// catches every per-address failure and returns it as that entry's `error`
// STRING with `balances: null`, deliberately, so one refused address does not
// sink the whole wallet's numbers. `getWalletBalances` therefore RESOLVES on a
// 429 - nothing is thrown - and before this change Home read the entries not at
// all: a limited wallet showed rows with no balance and said nothing about why.
//
// What is pinned here:
//   1. the copy says what happened and for how long, in seconds the origin
//      itself named, and the number MOVES, so the screen is visibly waiting
//      rather than visibly broken;
//   2. at zero the wallet re-asks BY ITSELF - "; retrying." is a promise - and
//      the banner goes when balances land;
//   3. an SDK that names no seconds (the pinned 0.15.1, or an origin that sent
//      no Retry-After) says "a moment" instead of counting down a number the
//      wallet invented;
//   4. the 20 s beat does not fire through a load that is still in flight. A
//      honoured Retry-After can hold one request for up to 60 s, and three
//      loads queued against the bucket the first is waiting on is how one 429
//      becomes three.
//
// Timers are fully faked: the countdown IS a timer, so real ones would make
// this a sleep. Nothing here uses RTL's `waitFor`, which polls on a real
// interval; the promises are all pre-resolved mocks, so flushing microtasks
// inside `act` settles a load deterministically.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const CHAIN = 'litecoin-regtest';
const ADDRESS = 'rltc1qexample';

/** What the aggregator returns when an address read was refused. */
const refused = (message) => ({
    [CHAIN]: [{
        address: ADDRESS, balances: null, error: message, errorCode: null, retryAfterSeconds: null,
    }],
});

/**
 * The same, with the failure TYPED: the aggregator copies the SDK error's
 * `code` and `retryAfterSeconds` onto the entry, so the number does not have
 * to be recovered from the sentence.
 */
const refusedTyped = (message, errorCode, retryAfterSeconds) => ({
    [CHAIN]: [{
        address: ADDRESS, balances: null, error: message, errorCode, retryAfterSeconds,
    }],
});

/** What it returns when the read went through. */
const landed = {
    [CHAIN]: [{
        address: ADDRESS, balances: {}, error: null, errorCode: null, retryAfterSeconds: null,
    }],
};

const RATE_LIMITED_WITH_SECONDS =
    `Explorer returned HTTP 429 for /RLTC/api/balances/${ADDRESS}; retry after 3 seconds`;
// The shipped SDK 0.15.1 shape: same prefix, no seconds anywhere.
const RATE_LIMITED_NO_SECONDS = `Explorer returned HTTP 429 for /RLTC/api/balances/${ADDRESS}`;

function baseMessaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
    };
}

function mountHome(messaging) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { activeWalletId: WALLET.id }),
        ),
    );
}

const onScreen = () => document.body.textContent || '';

/** Let a load's chain of awaited promises settle without moving the clock. */
async function settle() {
    for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await Promise.resolve(); });
    }
}

/** Move the clock, run whatever that fires, and let it settle. */
async function advance(ms) {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await settle();
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Home shows a rate limit as a wait, not as a broken screen', () => {
    it('counts the named seconds down and re-loads by itself at zero', async () => {
        vi.useFakeTimers();
        const messaging = baseMessaging();
        messaging.getWalletBalances
            .mockResolvedValueOnce(refused(RATE_LIMITED_WITH_SECONDS))
            .mockResolvedValue(landed);

        mountHome(messaging);
        await settle();

        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);
        expect(onScreen()).toContain(
            "Couldn't load balances. The service asked the wallet to slow down for 3 seconds; retrying.",
        );
        // The wire text the wallet used to print instead.
        expect(onScreen()).not.toMatch(/Explorer returned|\/RLTC\/api|429/);

        await advance(1_000);
        expect(onScreen()).toContain('slow down for 2 seconds; retrying.');
        await advance(1_000);
        expect(onScreen(), 'the last tick must not read "1 seconds"')
            .toContain('slow down for 1 second; retrying.');

        // Zero: nobody clicked anything, and the wallet asked again.
        await advance(1_000);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);
        expect(onScreen(), 'the banner outlived the balances that landed')
            .not.toMatch(/slow down|Couldn't load balances/);
    });

    it('counts down the seconds the ENTRY names, with no number in the sentence', async () => {
        // Row 40: the entry carries the SDK error's `code` and
        // `retryAfterSeconds` as plain fields, so the message never has to be
        // re-parsed. The prose here is the no-header shape ("a moment" is all
        // the regex could ever get out of it); 42 can only have come from the
        // field. Strip the field or stop passing it and this goes red while
        // every string-only case above stays green.
        vi.useFakeTimers();
        const messaging = baseMessaging();
        messaging.getWalletBalances.mockResolvedValue(
            refusedTyped(RATE_LIMITED_NO_SECONDS, 'RATE_LIMITED', 42),
        );

        mountHome(messaging);
        await settle();

        expect(onScreen(), 'the typed seconds lost to the message regex')
            .toContain('slow down for 42 seconds; retrying.');
        await advance(1_000);
        expect(onScreen()).toContain('slow down for 41 seconds; retrying.');
    });

    it('lets the entry\'s CODE decide the cause when the message carries no 429 prefix', async () => {
        // The mapper trusts a `RATE_LIMITED` code only beside the service that
        // minted it or the "Explorer returned HTTP 429" opener; the aggregator
        // states the service, since a balance read is always an explorer read.
        // A reworded SDK message must therefore still produce the countdown.
        vi.useFakeTimers();
        const messaging = baseMessaging();
        messaging.getWalletBalances.mockResolvedValue(
            refusedTyped('The explorer refused this read', 'RATE_LIMITED', 42),
        );

        mountHome(messaging);
        await settle();

        expect(onScreen(), 'the code alone did not decide the cause')
            .toContain('slow down for 42 seconds; retrying.');
    });

    it('says "a moment" when nothing named a number, and does not invent one', async () => {
        vi.useFakeTimers();
        const messaging = baseMessaging();
        messaging.getWalletBalances.mockResolvedValue(refused(RATE_LIMITED_NO_SECONDS));

        mountHome(messaging);
        await settle();

        expect(onScreen()).toContain(
            "Couldn't load balances. The service asked the wallet to slow down for a moment; retrying.",
        );
        // A second later it still says "a moment": there is no number to count.
        await advance(1_000);
        expect(onScreen()).toContain('slow down for a moment; retrying.');
        expect(onScreen()).not.toMatch(/slow down for \d/);
    });

    it('clears the banner as soon as a later load lands', async () => {
        vi.useFakeTimers();
        const messaging = baseMessaging();
        messaging.getWalletBalances
            .mockResolvedValueOnce(refused(RATE_LIMITED_WITH_SECONDS))
            .mockResolvedValue(landed);

        mountHome(messaging);
        await settle();
        expect(onScreen()).toContain('slow down for 3 seconds');

        await advance(3_000);
        expect(onScreen()).not.toMatch(/slow down/);
        // ...and it stays gone across the next beat.
        await advance(BALANCE_POLL_INTERVAL_MS);
        expect(onScreen()).not.toMatch(/slow down/);
    });

    it('applies the balances its own re-load returns, though firing it tore the ticker down', async () => {
        // Reaching zero clears `rateLimitRetryAt`, which unmounts the ticking
        // effect in the same commit. A re-load cancelled by its own trigger
        // discards the balances it just asked for, and the banner it promised
        // to clear stays up for good - invisible with an instantly-resolved
        // mock, certain with a real read that takes longer than the commit.
        vi.useFakeTimers();
        /** @type {(v: unknown) => void} */
        let answerTheReload = () => {};
        const messaging = baseMessaging();
        messaging.getWalletBalances
            .mockResolvedValueOnce(refused(RATE_LIMITED_WITH_SECONDS))
            .mockImplementationOnce(() => new Promise((resolve) => { answerTheReload = resolve; }));

        mountHome(messaging);
        await settle();
        await advance(3_000);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(2);
        // The read answers only now, well after the effect that asked went away.
        await act(async () => { answerTheReload(landed); });
        await settle();

        expect(onScreen()).not.toMatch(/slow down|Couldn't load balances/);
    });

    it('does not start a second load while the first is still in flight', async () => {
        vi.useFakeTimers();
        const messaging = baseMessaging();
        // A load that never answers: exactly the shape of one waiting out a
        // 60 s Retry-After inside the SDK.
        messaging.getWalletBalances.mockImplementation(() => new Promise(() => {}));

        mountHome(messaging);
        await settle();
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);

        await advance(BALANCE_POLL_INTERVAL_MS);
        expect(messaging.getWalletBalances, 'the beat stacked a load on one in flight')
            .toHaveBeenCalledTimes(1);
        await advance(BALANCE_POLL_INTERVAL_MS * 2);
        expect(messaging.getWalletBalances).toHaveBeenCalledTimes(1);
    });
});
