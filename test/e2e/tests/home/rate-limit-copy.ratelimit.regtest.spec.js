// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AT6 of the rate-limits design (the "rate limits that fit the wallet" spec,
// §5): the wallet, on a regtest explorer that serves only a handful of
// requests a minute, shows "The service asked the wallet to slow down for N
// seconds; retrying" with N counting down, and its balances come back with no
// click once the window passes.
//
// What is being proved, and why it needs a throttled venue rather than a
// stub. Before this milestone the wallet's SDK clamped every `Retry-After`
// to two seconds, so its one retry landed inside the same window, and the
// copy it then showed was "temporarily unavailable (error 429)": a sentence
// that made a tester behind a NAT reach for a VPN. The fix is three layers
// deep (the SDK honours the header, the mapper says what the service asked,
// Home counts it down and re-loads) and only a real limiter, with a real
// window and a real header, drives all three at once.
//
// VENUE, deliberately not the campaign's. The shared regtest explorer is
// pinned at 5000 rpm so the whole Playwright campaign fits through one
// tunnel; this drive needs the opposite. Run it against a SECOND explorer
// container serving `EXPLORER_RATE_LIMIT_RPM=20` (same image and env as the
// shared one plus that variable), with the Mac's 18080 tunnelled onto that
// container so the wallet's stock regtest descriptor needs no edit:
//
//   ssh -N -L 18080:localhost:18090 <regtest host>
//   XC_RATE_LIMIT_AT6=1 XC_REGTEST_COIN=RLTC pnpm -C test/e2e exec playwright test \
//       --config playwright.ratelimit.config.js
//
// The spec refuses to run against anything whose `RateLimit-Limit` header is
// generous enough to be the shared venue, so pointing it at the wrong
// explorer fails in the first second, not after ten minutes of waiting for
// a 429 that never comes.
//
// MECHANICS. The limiter keys on the client address, and through one tunnel
// the wallet and this Node process share one; a burst loop from here holds
// the bucket full (a refused request still counts against the window, which
// is express-rate-limit's default), so every read the wallet makes is a 429,
// its honoured wait ends in another 429, and the copy appears. Stopping the
// loop is "the window passes": the countdown reaches zero, Home re-loads,
// the SDK waits out the fresh window, and the balances land.

import { createWallet, expect, test, unlockedShell } from '../../fixtures/wallet.js';
import { switchToRegtest, unlockAfterReload, EXPLORER_URL, REGTEST_COIN } from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';

const PASSWORD = 'regtestpassword123';

// Anything above this is not a throttled venue. The shared explorer serves
// 1080 (shipped) or 5000 (campaign pin); AT6 names 20.
const THROTTLED_VENUE_MAX_RPM = 60;

// The copy the mapper produces for a 429 (explorerErrors.rateLimitedMessage),
// as Home renders it on its load banner. The wire text must never appear.
const COPY_RE = /asked the wallet to slow down for (\d+) seconds; retrying/;
const WIRE_RE = /Explorer returned HTTP|error 429|temporarily unavailable/i;

// Holds the venue's bucket full: 30 a minute against a 20-a-minute window.
function startBurst() {
    let stopped = false;
    let inflight = 0;
    const tick = async () => {
        if (stopped) return;
        inflight += 1;
        try {
            await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, { signal: AbortSignal.timeout(5_000) });
        } catch { /* a refused or timed-out probe still did its job */ }
        inflight -= 1;
    };
    const timer = setInterval(tick, 2_000);
    void tick();
    return {
        stop: async () => {
            stopped = true;
            clearInterval(timer);
            // Let the last probe settle so it cannot land inside the window
            // the recovery half is waiting to reset.
            while (inflight > 0) await new Promise((r) => setTimeout(r, 200));
        },
    };
}

test.describe('rate-limit copy and recovery against a throttled explorer (AT6)', () => {
    // Two windows to reach the copy (the honoured wait plus the failed retry),
    // one countdown, one more window to recover: six minutes is the budget.
    test.setTimeout(720_000);

    test.beforeAll(async () => {
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/status`, { signal: AbortSignal.timeout(10_000) });
        const limit = Number(res.headers.get('ratelimit-limit'));
        expect(
            Number.isFinite(limit) && limit > 0 && limit <= THROTTLED_VENUE_MAX_RPM,
            `localhost:18080 answers RateLimit-Limit ${res.headers.get('ratelimit-limit')}; AT6 needs the `
            + `throttled venue (EXPLORER_RATE_LIMIT_RPM=20), not the shared explorer. See the spec header.`,
        ).toBe(true);
    });

    test('shows the slow-down copy with a countdown, then recovers on its own', async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });

        const burst = startBurst();
        try {
            // A cold open is the one path that surfaces a load failure (a silent
            // poll never stomps a screen the user is looking at), so reload.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const banner = page.getByRole('alert').filter({ hasText: COPY_RE });
            // Up to two full windows: the SDK waits out the first 429's
            // Retry-After, retries into the still-full bucket, and only that
            // second refusal reaches Home.
            await expect(banner, 'the slow-down copy never appeared').toBeVisible({ timeout: 150_000 });

            const first = Number(COPY_RE.exec(await banner.innerText())[1]);
            await expect
                .poll(async () => Number((COPY_RE.exec(await banner.innerText()) || [])[1]), {
                    timeout: 15_000,
                    message: `the countdown never moved below ${first}`,
                })
                .toBeLessThan(first);

            expect(await page.getByRole('alert').allInnerTexts()).not.toEqual(
                expect.arrayContaining([expect.stringMatching(WIRE_RE)]),
            );
        } finally {
            await burst.stop();
        }

        // The window passes: the countdown reaches zero, Home re-loads, the SDK
        // waits out whatever the fresh 429 says, and the load lands. Nothing is
        // clicked.
        await expect(page.getByRole('alert').filter({ hasText: COPY_RE }), 'the banner never cleared')
            .toHaveCount(0, { timeout: 200_000 });
        await expect(unlockedShell(page)).toBeVisible();
        await expect(page.getByRole('alert').filter({ hasText: WIRE_RE })).toHaveCount(0);
    });
});
