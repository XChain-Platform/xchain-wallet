// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The batch balance read of the rate-limits design (the "rate limits that fit
// the wallet" spec, §4 M3b): a wallet poll costs ONE explorer request per
// chain on `POST /{COIN}/api/balances`, not two per address, and a wallet
// pointed at an explorer without that route falls back to the per-address
// reads and renders the same balances.
//
// What is being proved. The flow layer feature-detects the batch route on the
// SDK and on the explorer, so the same wallet build behaves two ways depending
// on what localhost:18080 answers. Each way is one run of this spec, named by
// XC_BATCH_EXPECT:
//
//   batch     18080 is an explorer that serves the route (a twin carrying the
//             build); the browser's own request log must show one POST per
//             chain per poll and no per-address balance GET.
//   fallback  18080 is an explorer WITHOUT the route (the shared regtest
//             explorer until it is redeployed; it answers the POST with a
//             JSON-RPC error at HTTP 200, which the SDK names and the flow
//             remembers); the log must show the per-address GETs, no POST
//             after the first refused probe, and the balances still render.
//
// Run, with the Mac's 18080 tunnelled onto the venue named above and the web
// shell built with the SDK that carries getBalancesBatch:
//
//   XC_RATE_LIMIT_AT6=1 XC_BATCH_EXPECT=batch XC_REGTEST_COIN=RLTC \
//       pnpm -C test/e2e exec playwright test --config playwright.ratelimit.config.js \
//       tests/home/batch-balances.ratelimit.regtest.spec.js
//
// (XC_RATE_LIMIT_AT6 only unlocks the config; this spec never needs a
// throttled venue and checks the route itself in beforeAll.)
//
// MECHANICS. The wallet is given two more addresses on the venue chain, so the
// batch body carries three addresses and the fallback run shows three pairs of
// GETs. Counting starts one full poll interval after the shell is unlocked,
// so the cold open's requests (and, on the fallback venue, the one refused
// probe that teaches the flow the route is absent) sit outside the window;
// the window then closes after another interval, which holds exactly one
// poll of every chain.

import { createWallet, expect, test, unlockedShell } from '../../fixtures/wallet.js';
import { switchToRegtest, selectVenueChain, EXPLORER_URL, REGTEST_COIN, REGTEST_CHAIN_ID, REGTEST_TICKER } from '../../fixtures/regtest.js';
import { kdfStepTimeout } from '../../timeout-budget.js';
import { BALANCE_POLL_INTERVAL_MS } from '../../../../packages/core/src/flows/balances.js';

const PASSWORD = 'regtestpassword123';
const EXPECT = process.env.XC_BATCH_EXPECT;
const EXTRA_ADDRESSES = 2;

const WIRE_RE = /Explorer returned HTTP|error 429|temporarily unavailable/i;

function isBalanceRead(url) {
    return /\/api\/(balances|address)(\/|$)/.test(new URL(url).pathname);
}

/** `POST .../api/balances` is the batch route; `GET .../api/balances/{a}` and `GET .../api/address/{a}` are the per-address reads. */
function classify(method, url) {
    const path = new URL(url).pathname;
    if (method === 'POST' && /\/api\/balances$/.test(path)) return 'batch';
    if (method === 'GET' && /\/api\/balances\/[^/]+$/.test(path)) return 'balances-get';
    if (method === 'GET' && /\/api\/address\/[^/]+$/.test(path)) return 'address-get';
    return null;
}

async function gotoPalette(page, title) {
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog, 'the command palette did not open').toBeVisible({ timeout: 15_000 });
    const combobox = dialog.getByRole('combobox').first();
    await expect(combobox).toBeEditable({ timeout: 15_000 });
    await combobox.fill(title);
    const row = page.getByRole('option', { name: new RegExp(`^${title}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible();
    await row.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function listedAddresses(page) {
    const rows = page.getByRole('button', { name: /^View address / });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    return (await Promise.all((await rows.all()).map((r) => r.getAttribute('aria-label'))))
        .map((l) => String(l).replace('View address ', ''))
        .filter(Boolean);
}

async function generateVenueAddress(page) {
    await gotoPalette(page, 'Addresses');
    const before = new Set(await listedAddresses(page));
    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Add address' }).click();
    await selectVenueChain(page, 'Coin');
    await page.getByRole('button', { name: /^Generate/ }).click();
    const generated = (await listedAddresses(page)).filter((a) => !before.has(a));
    expect(generated.length, 'generating added exactly one address to the list').toBe(1);
    return generated[0];
}

test.describe(`batch balance reads (${EXPECT})`, () => {
    test.setTimeout(600_000);

    test.beforeAll(async () => {
        expect(['batch', 'fallback'].includes(EXPECT), 'set XC_BATCH_EXPECT=batch or fallback').toBe(true);
        // A route that exists refuses an empty body with 400. An explorer
        // without it hands the POST to its JSON-RPC router, which answers an
        // error object at HTTP 200 (a deployment that refuses unknown POSTs
        // outright answers 404 instead). Anything else is the wrong venue.
        const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/balances`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON: judged by status alone */ }
        const rpcError = res.status === 200 && json && json.error && typeof json.error.code === 'number';
        const routeAbsent = res.status === 404 || rpcError;
        const seen = `localhost:18080 answers ${res.status} ${text.slice(0, 80)} to an empty batch POST`;
        if (EXPECT === 'batch') expect(res.status, `${seen}; the batch run needs the route (400)`).toBe(400);
        else expect(routeAbsent, `${seen}; the fallback run needs an explorer without the route (404, or a JSON-RPC error at 200)`).toBe(true);
    });

    test(`one poll is ${EXPECT === 'batch' ? 'one batch POST per chain' : 'the per-address GETs'} and the balances render`, async ({ page }) => {
        await createWallet(page, { password: PASSWORD });
        await switchToRegtest(page, PASSWORD);
        await expect(unlockedShell(page)).toBeVisible({ timeout: kdfStepTimeout() });

        const extra = [];
        for (let i = 0; i < EXTRA_ADDRESSES; i += 1) extra.push(await generateVenueAddress(page));
        await gotoPalette(page, 'Home');
        await expect(unlockedShell(page)).toBeVisible();

        // Let the cold open (and the fallback venue's one refused probe per
        // chain) pass before counting.
        await page.waitForTimeout(BALANCE_POLL_INTERVAL_MS + 2_000);

        const seen = [];
        const onRequest = (req) => {
            if (!isBalanceRead(req.url())) return;
            const kind = classify(req.method(), req.url());
            if (!kind) return;
            seen.push({ kind, coin: new URL(req.url()).pathname.split('/')[1], body: kind === 'batch' ? req.postDataJSON() : null });
        };
        page.on('request', onRequest);
        await page.waitForTimeout(BALANCE_POLL_INTERVAL_MS + 2_000);
        page.off('request', onRequest);

        const count = (kind) => seen.filter((r) => r.kind === kind).length;
        const coins = [...new Set(seen.map((r) => r.coin))];
        expect(coins.length, 'no balance traffic at all inside one poll interval').toBeGreaterThan(0);

        if (EXPECT === 'batch') {
            expect(count('balances-get') + count('address-get'), `per-address reads inside the window: ${JSON.stringify(seen)}`).toBe(0);
            const venueBatches = seen.filter((r) => r.kind === 'batch' && r.coin === REGTEST_COIN);
            expect(venueBatches.length, `batch POSTs for ${REGTEST_COIN} inside one poll: ${JSON.stringify(seen)}`).toBe(1);
            const addresses = venueBatches[0].body && venueBatches[0].body.addresses;
            expect(addresses, 'the batch body carries the addresses array').toBeInstanceOf(Array);
            expect(addresses.length).toBe(1 + EXTRA_ADDRESSES);
            for (const a of extra) expect(addresses, `generated address ${a} missing from the batch`).toContain(a);
            for (const coin of coins) {
                expect(seen.filter((r) => r.kind === 'batch' && r.coin === coin).length, `one batch per poll for ${coin}`).toBe(1);
            }
        } else {
            expect(count('batch'), `batch POSTs after the route was found absent: ${JSON.stringify(seen)}`).toBe(0);
            const venueGets = seen.filter((r) => r.kind === 'balances-get' && r.coin === REGTEST_COIN).length;
            expect(venueGets, `per-address balance GETs for ${REGTEST_COIN} inside one poll`).toBe(1 + EXTRA_ADDRESSES);
        }

        // Either way the balances are on screen: the venue chain's native row,
        // and no wire text on any banner.
        await expect(page.locator(`[data-balance-key="${REGTEST_CHAIN_ID}:${REGTEST_TICKER}"]`).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('alert').filter({ hasText: WIRE_RE })).toHaveCount(0);
    });
});
