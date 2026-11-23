// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CALLBACK, driven from the wallet against a live regtest chain: configure
// a token's payout via "Callback settings", then fire the recall via
// "Execute callback".
//
// Both surfaces were exercised only against the dev-mock SDK before this
// file, which means neither ever produced a signature the chain accepted.
// "Callback settings" composes an ISSUE v4 update (VERSION|TICK|
// CALLBACK_BLOCK|CALLBACK_TICK|CALLBACK_AMOUNT per issue.js), and
// "Execute callback" composes CALLBACK itself; this spec drives both
// through the real signer and reads the result back off the chain rather
// than off the wallet's own success screens: broadcast, wait for
// indexing, assert the on-chain result, the same standard the other
// money-path regtest specs in this suite already hold themselves to.
//
// WHY XCHAIN IS THE PAYOUT TICKER. A callback pays holders in a SECOND
// token the owner must be able to cover. XCHAIN is free-mintable on
// regtest by any address (see `mintXchain`), so it is the one payout
// ticker this spec can obtain without a second funded wallet.
//
// WHY THIS RUN HAS ZERO HOLDERS, AND WHY THAT IS STILL A REAL PROOF. The
// spec issues to itself and never distributes, so the payout owed is
// zero holders x CALLBACK_AMOUNT = nothing. That does not make CALLBACK a
// no-op: the action still has to pass the protocol's own gates (owner-
// only, after CALLBACK_BLOCK, config complete) and the chain still has to
// index it as `valid`. What a zero-holder run cannot prove is the payout
// arithmetic itself; that is a second token's holder ledger and belongs
// to its own spec, not this one.
//
// THE BLOCK-HEIGHT GATE USES BOTH FORM AND CHAIN HEIGHTS. "Callback
// settings" prints the wallet indexer watermark; the callback block is
// five blocks past the larger of that watermark and the explorer's chain
// tip. The confirm gate this spec is proving (§ CallbackForm
// `blockReached`) needs the WALLET's own watermark to have moved to it, so
// this spec re-fetches the token detail (a fresh ManageToken mount) after
// mining, rather than trusting the block was reached because two blocks
// were mined.

import {
    clickManageTokenAction,
    createWallet,
    expect,
    expectManageTokenView,
    openPaletteCommand,
    test,
} from '../../fixtures/wallet.js';
import {
    callbackBlockAhead,
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    expectConfirmModal,
    fundAddress,
    issuePlainToken,
    readIssueSource,
    healVenueClock,
    mintXchain,
    nudgeChain,
    seedPrices,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm as approveWhenReady,
    searchMyTokens,
} from '../../fixtures/regtest.js';
import { fieldByLabel, searchTokenPicker } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
const TICK = `CBK${STAMP}`;
const PAYOUT_TICK = 'XCHAIN';
const PAYOUT_AMOUNT = '1';
/** Gas-free action, but the callback payout token still needs minting. */
const XCHAIN_MINT = 50;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/**
 * Fills the password when the confirm screen asks for one and approves.
 *
 * Tolerant of an already-unlocked signer (no password field at all), which
 * is the state every onboard-then-reload sequence in this file leaves the
 * wallet in.
 */
async function approveConfirm(page, what = 'this action') {
    const modal = await expectConfirmModal(page, what, 90_000);
    const password = fieldByLabel(page, 'Password');
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await approveWhenReady(page);
    return modal;
}

/** Reads the 64-hex-char transaction id printed on a form's done screen. */
async function readDoneTxid(page, timeoutMs = 180_000) {
    const main = page.getByRole('main');
    await expect(main, 'the done screen never printed a transaction id')
        .toContainText(/[0-9a-f]{64}/, { timeout: timeoutMs });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'no 64-hex-char transaction id found on the done screen').toBeTruthy();
    return txid;
}

/** Opens My Tokens (via the wallet menu) filtered to one ticker, and opens it. */
async function openManageToken(page, tick) {
    await openPaletteCommand(page, 'My tokens');
    const main = page.getByRole('main');
    // The search sits in the title bar's "Filter tokens" menu, outside main.
    await searchMyTokens(page, tick);
    const row = main.getByRole('button', { name: `Open ${tick} token details`, exact: true });
    await expect(row.first(), `My Tokens does not list ${tick}`).toBeVisible({ timeout: 60_000 });
    await row.first().click();
    // The token opens as the "<TICK> token management" view beside the list.
    await expectManageTokenView(page, 'Manage Token did not open on this ticker');
    await expect(page.getByRole('region', { name: `${tick} token management`, exact: true }),
        `the management view is not showing ${tick}`).toBeVisible({ timeout: 30_000 });
    return main;
}

async function openExecuteCallbackWhenConfigured(page, tick, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const main = await openManageToken(page, tick);
        // "Recall tokens" is an Actions row that stays aria-disabled until
        // the token's callback config has been read back from the chain.
        const execute = main.locator('[data-action-id="execute-callback"]').first();
        await expect(execute, 'Manage Token has no "Recall tokens" action').toBeVisible({ timeout: 30_000 });
        if ((await execute.getAttribute('aria-disabled')) !== 'true') {
            await execute.click();
            return main;
        }
        await nudgeChain();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    throw new Error(`Manage Token did not offer "Recall tokens" within ${timeoutMs} ms`);
}

/** The block height printed on the Callback settings form ("Current block: N."). */
async function readCurrentHeightFromForm(main) {
    const hint = main.getByText(/^Current block: /);
    await expect(hint, 'Callback settings never printed the current block height').toBeVisible({ timeout: 30_000 });
    const text = await hint.innerText();
    const match = text.match(/Current block:\s*([\d,]+)\./);
    expect(match, `unparseable current-block hint: ${text}`).toBeTruthy();
    return Number(match[1].replace(/,/g, ''));
}

/** Mines until the venue's own chain tip is at or past `target`. */
async function mineToHeight(target, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let tip = -1;
    while (Date.now() < deadline) {
        await nudgeChain();
        const status = await explorerJson('status');
        tip = Number(status?.chain_tip?.[REGTEST_COIN]);
        if (Number.isFinite(tip) && tip >= target) return tip;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`chain tip never reached block ${target} (last seen ${tip})`);
}

test.describe(`Callback config and execute on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    // The ISSUE and the callback config each wait for the rail indexer, which
    // can trail the tip by several blocks on a shared venue for most of a run.
    test.setTimeout(3_600_000);

    test.beforeAll(async () => {
        await healVenueClock();
    });

    test('a callback configured through Callback settings fires through Execute callback and the chain records both', async ({ page }) => {
        let owner;
        let cbBlock;

        await test.step('onboard, fund, and issue a token with no callback yet', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Callback Wallet' });
            await switchToRegtest(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            let main = page.getByRole('main');
            await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
            owner = await readIssueSource(main);
            expect(owner, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(owner, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            // XCHAIN is the callback payout token this spec uses; mint it now
            // so the wallet holds enough to cover a (zero-holder) payout.
            await mintXchain(page, XCHAIN_MINT);
            await waitForTokenBalance(owner, 'XCHAIN', XCHAIN_MINT);

            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            main = page.getByRole('main');
            await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
            expect(await readIssueSource(main), 'still signing with the funded address').toBe(owner);
            await issuePlainToken(main, { ticker: TICK, supply: SUPPLY });

            await approveConfirm(page, 'the ISSUE');
            const txid = await readDoneTxid(page);
            const action = await waitForValidAction(txid);
            expect(action.action).toBe('ISSUE');
            expect(action.source).toBe(owner);
        });

        await test.step('configure the callback via Callback settings, and the chain records the config', async () => {
            let main = await openManageToken(page, TICK);
            await clickManageTokenAction(main, 'Callback settings');

            main = page.getByRole('main');
            // Callback token is a token field: a button that opens the token
            // picker, never a typed box.
            const callbackToken = main.getByRole('button', { name: /^Callback token:/ });
            await expect(callbackToken, 'Callback settings never rendered its fields')
                .toBeVisible({ timeout: 30_000 });

            const currentHeight = await readCurrentHeightFromForm(main);
            cbBlock = await callbackBlockAhead(currentHeight);

            await callbackToken.click();
            await searchTokenPicker(page, PAYOUT_TICK);
            await page.getByRole('button', { name: new RegExp(`^Select ${PAYOUT_TICK} on `) }).first()
                .click({ timeout: 30_000 });
            main = page.getByRole('main');
            await expect(main.getByRole('button', { name: new RegExp(`^Callback token: ${PAYOUT_TICK} on `) }))
                .toBeVisible({ timeout: 30_000 });
            await fieldByLabel(main, 'Payout per unit').fill(PAYOUT_AMOUNT);
            await fieldByLabel(main, 'Callback allowed from block').fill(String(cbBlock));
            await main.getByRole('button', { name: 'Update callback settings', exact: true }).click();

            await approveConfirm(page, 'the callback settings update');
            const txid = await readDoneTxid(page);
            const action = await waitForValidAction(txid);
            // Callback settings ride as an ISSUE v4 update (issue.js), never
            // a standalone action of their own.
            expect(action.action).toBe('ISSUE');
            expect(action.source).toBe(owner);

            // Independent of the wallet's own "Callback settings updated"
            // screen: the explorer's token record is the chain's own copy of
            // the config, and it is what CallbackForm itself reads.
            const token = await explorerJson(`token/${TICK}`);
            expect(String(token?.callback?.tick || '').toUpperCase(),
                'the chain does not record the callback payout ticker that was set').toBe(PAYOUT_TICK);
            expect(Number(token?.callback?.amount),
                'the chain does not record the callback payout amount that was set').toBe(Number(PAYOUT_AMOUNT));
            expect(Number(token?.callback?.block),
                'the chain does not record the callback block that was set').toBe(cbBlock);
        });

        await test.step('mine past the callback block, and Execute callback records CALLBACK as valid', async () => {
            await mineToHeight(cbBlock);

            // Fresh mount: ManageToken and CallbackForm both read live state
            // (assetInfo, the indexer watermark), so re-opening from My Tokens
            // is what proves the BLOCK GATE lifted rather than assuming it did.
            const main = await openExecuteCallbackWhenConfigured(page, TICK);
            const execute = main.getByRole('button', { name: 'Recall Tokens', exact: true });
            await expect(execute, 'Recall tokens never became available (block gate or missing config)')
                .toBeEnabled({ timeout: 60_000 });
            await execute.click();

            await approveConfirmWithTypedCallback(page);
            const txid = await readDoneTxid(page);

            const action = await waitForValidAction(txid);
            expect(action.action, 'the recall did not land as a CALLBACK action').toBe('CALLBACK');
            expect(action.source, 'the callback was not signed by the token owner').toBe(owner);

            // Independent of the action-detail read above: the explorer's
            // dedicated by-token callback list is what the CALLBACK v0
            // protocol page (`/api/callbacks/{TICK}/token`) exists for, and it
            // is a different query path than `waitForValidAction`.
            const byToken = await explorerJson(`callbacks/${TICK}/token`);
            const rows = Array.isArray(byToken?.data) ? byToken.data : [];
            const mine = rows.find((r) => r.tx_hash === txid);
            expect(mine, `the callbacks-by-token list carries no row for ${txid}`).toBeTruthy();
        });
    });
});

/**
 * The confirm screen for Execute callback carries its own typed-word gate
 * ("CALLBACK") inside the credentials area, ahead of the password. Approve
 * stays disabled until both the signer and the typed word are ready.
 */
async function approveConfirmWithTypedCallback(page) {
    const modal = await expectConfirmModal(page, 'the callback recall', 90_000);
    const typed = fieldByLabel(page, 'Type "RECALL" to confirm');
    await expect(typed, 'the confirm screen carries no typed-confirmation field for RECALL')
        .toBeVisible({ timeout: 30_000 });
    await typed.fill('RECALL');
    const password = fieldByLabel(page, 'Password');
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await approveWhenReady(page);
    return modal;
}
