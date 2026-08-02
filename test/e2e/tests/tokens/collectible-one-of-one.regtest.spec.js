// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> the COLLECTIBLE template: the
// wizard's 1-of-1, and the last of its seven templates to carry a promise the
// chain has to keep rather than a field the chain merely records.
//
// WHAT THE TEMPLATE CLAIMS. `TEMPLATE_COMPOSERS.collectible` hard-wires
// DECIMALS 0, MAX_SUPPLY 1, MINT_SUPPLY 1, LOCK_MAX_SUPPLY 1 and LOCK_MINT 1,
// and puts the image URL in DESCRIPTION (the TIS IMAGE format). The user picks
// a name and a picture; every number is the template's. So the claim is not
// "a token exists" - it is "exactly one of these will ever exist, permanently".
//
// WHY A SUPPLY READ WOULD PROVE NOTHING. A token reading `max_supply: 1` with
// `locks: {max_supply: true, mint: true}` proves the wallet WROTE five fields,
// not that anything is frozen - the exact mistake Session 39's genesis-locks
// pair was built to avoid. Uniqueness here is enforced by THREE independent
// rules in two different handlers, so the test asks the chain to refuse three
// different attacks and reads WHICH rule refused each, at the same block:
//
//   ISSUE  MAX_SUPPLY=2   -> invalid: MAX_SUPPLY (locked)         issue.js line ~400
//   MINT   AMOUNT=1       -> invalid: LOCK_MINT                   mint.js
//   ISSUE  MINT_SUPPLY=1  -> invalid: MINT_SUPPLY exceeds MAX_SUPPLY   issue.js line ~388
//
// ...against a POSITIVE CONTROL in the same run: an edit to the DESCRIPTION,
// which this template does NOT lock, must be `valid`. Without it, a token that
// could not be edited at all - or a venue refusing everything for an unrelated
// reason - would pass a test that only looked for refusals.
//
// ⚠️ THE THIRD REFUSAL IS THE ONE WORTH READING, AND IT NAMES A FLAG DAY RATHER
// THAN A LOCK. The template does NOT set LOCK_MINT_SUPPLY, so nothing on the
// token itself stops its owner re-ISSUEing the same tick with MINT_SUPPLY=1:
// MINT_SUPPLY is credited on EVERY valid ISSUE, not just the first, and a
// re-ISSUE that simply omits MAX_SUPPLY never trips the locked-cap check. What
// stops it is `ISSUE_MINT_SUPPLY_CUMULATIVE_CAP`, a gated protocol change whose
// own comment says it closes inflation "past a locked NFT edition size".
// `protocol_changes.js` activates it on testnet/regtest AT GENESIS - which is
// why this spec can assert it - and on MAINNET at 1786924800, i.e. 2026-08-17.
// So on regtest this refusal is real today, and the mainnet window is read off
// the config rather than driven here (this venue cannot turn the gate off).
// Filed as .
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/collectible-one-of-one.regtest.spec.js

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    seedPrices,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** One ISSUE, paying a real coin fee . */
const FUNDING = 3;
const STAMP = Date.now().toString().slice(-6);
const TICK = `COL${STAMP}`;
const IMAGE_URL = `https://example.com/art/${STAMP}.png`;

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

/**
 * Builds an ISSUE v0 parameter string from named fields.
 *
 * Written out rather than hand-counted pipes: format 0 has 25 positional
 * fields, and an off-by-one silently moves LOCK_MINT into LOCK_MINT_SUPPLY,
 * which would make this file assert the opposite of what it means to.
 * Order is `issue.js` `this.formats[0]`.
 */
const ISSUE_V0_FIELDS = [
    'VERSION', 'TICK', 'MAX_SUPPLY', 'MAX_MINT', 'DECIMALS', 'DESCRIPTION',
    'MINT_SUPPLY', 'TRANSFER', 'TRANSFER_SUPPLY', 'LOCK_MAX_SUPPLY',
    'LOCK_MAX_MINT', 'LOCK_DESCRIPTION', 'LOCK_SLEEP', 'LOCK_CALLBACK',
    'CALLBACK_BLOCK', 'CALLBACK_TICK', 'CALLBACK_AMOUNT', 'ALLOW_LIST',
    'BLOCK_LIST', 'MINT_ADDRESS_MAX', 'MINT_START_BLOCK', 'MINT_STOP_BLOCK',
    'LOCK_MINT', 'LOCK_MINT_SUPPLY', 'MEMO',
];

function issueParams(fields) {
    const known = new Set(ISSUE_V0_FIELDS);
    for (const key of Object.keys(fields)) {
        if (!known.has(key)) throw new Error(`unknown ISSUE v0 field: ${key}`);
    }
    return ISSUE_V0_FIELDS
        .map((name) => (fields[name] === undefined ? '' : String(fields[name])))
        .join('|');
}

/** The venue's verdict for `action` with `params` from `source`. */
async function quote(action, params, source) {
    const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
    url.searchParams.set('action', action);
    url.searchParams.set('params', params);
    url.searchParams.set('source', source);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feequote ${action} -> ${res.status}`);
    return res.json();
}

/**
 * Mines a block while the decoder is keeping up.
 *
 * NOT `mempool_size > 0`, which is what §3.5 (Session 29) prescribes and what
 * every other spec here uses. That signal comes from the miner's own `status`,
 * and on this venue it is UNRELIABLE: measured 2026-08-01, `generate_blocks`
 * really mined (the explorer tip moved 4843 -> 4844) while the same miner's
 * `status` kept reporting `mempool_size: 0`, `blocks_mined: 676` and an
 * unchanged `last_mine_at`. A helper gated on that counter is inert, so a
 * broadcast action never gets the block that would confirm it and the run dies
 * on its own indexer wait with the pipeline perfectly healthy.
 *
 * The REASON Session 29 rejected unconditional mining still stands - it outran
 * the decoder and fed back into longer waits - so the guard moves to the thing
 * that reason was actually about: the decoder's own lag, read from the
 * explorer, which is independently observable and was correct throughout.
 */
async function mineIfBehind() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* best-effort; the waits below carry the timeout */ }
}

async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}. A lag that does not shrink over two `
        + 'reads is  wedging the venue, not a wallet defect (§3.7).');
}

async function waitForBalance(address, tick, want, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last === want) return last;
        await mineIfBehind();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`${tick} balance for ${address} never reached ${want} (last=${last})`);
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

async function expectConfirmScreen(page) {
    const screen = page.getByTestId('confirm-modal');
    const priceAlert = page.getByText(/fee price is temporarily unavailable/);
    await screen.or(priceAlert).first().waitFor({ state: 'visible', timeout: 90_000 });
    expect(await priceAlert.count(),
        'the venue could not price this action: the price sentinel has gone stale mid-run. Venue '
        + 'state, not a wallet defect - re-seed (campaign §3.2) and re-run')
        .toBe(0);
    await expect(screen).toBeVisible({ timeout: 60_000 });
}

async function approveAndGetTxid(page) {
    const approve = page.getByTestId('confirm-approve');
    await expect(approve).toBeEnabled({ timeout: 120_000 });
    await approve.click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    return (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
}

test.describe(`collectible 1-of-1 on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('the collectible template mints exactly one, and three separate rules keep it that way', async ({ page }) => {
        let owner;

        await test.step('onboard, fund, and create the collectible through the wizard', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Collectible Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const probe = page.getByRole('main');
            await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(probe);
            owner = await probe.getByLabel('From').inputValue();
            expect(owner, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(owner, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await seedPrices();

            await gotoPalette(page, 'Create a token');
            const main = page.getByRole('main');
            await main.getByRole('button', { name: /^Collectible/ }).click();
            await selectVenueChain(main);
            await expect.poll(async () => main.getByLabel('Fee paid by').inputValue().catch(() => ''),
                { timeout: 30_000, message: 'the wizard names no signing address' })
                .toMatch(REGTEST_ADDRESS_RE);
            await main.getByRole('button', { name: 'Next', exact: true }).click();

            // The template exposes only these three: every number is the
            // composer's, which is the whole point of the template and the
            // reason the chain record is checked field by field below.
            await expect(main.getByLabel('Token name (ticker)')).toBeVisible({ timeout: 30_000 });
            await main.getByLabel('Token name (ticker)').fill(TICK);
            await main.getByLabel('Image URL').fill(IMAGE_URL);
            expect(await main.getByLabel('Supply').count(),
                'the Collectible template offered a Supply field, so its 1-of-1 is no longer fixed '
                + 'by the composer')
                .toBe(0);
            await main.getByRole('button', { name: 'Issue token', exact: true }).click();

            await expectConfirmScreen(page);
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status), `the venue rejected the collectible: ${action.status}`)
                .toBe('valid');

            // The composer's five fixed fields, read back off the chain rather
            // than off the screen that claimed them.
            expect(String(action.max_supply), 'MAX_SUPPLY is not 1').toBe('1');
            expect(String(action.decimals), 'a collectible is divisible').toBe('0');
            expect(action.lock_max_supply, 'LOCK_MAX_SUPPLY was not written').toBeTruthy();
            expect(action.lock_mint, 'LOCK_MINT was not written').toBeTruthy();
            expect(String(action.description),
                'the image URL did not land in DESCRIPTION (the TIS IMAGE format)')
                .toBe(IMAGE_URL);

            await waitForBalance(owner, TICK, 1);
        });

        await test.step('the cap is frozen: raising MAX_SUPPLY is refused by the lock', async () => {
            const q = await quote('ISSUE', issueParams({ VERSION: 0, TICK, MAX_SUPPLY: 2 }), owner);
            expect(String(q.error || q.status),
                'the owner can raise a locked collectible\'s MAX_SUPPLY, so it is not a 1-of-1')
                .toMatch(/MAX_SUPPLY \(locked\)/i);
        });

        await test.step('minting more is refused by LOCK_MINT, not merely by the cap', async () => {
            // Worth separating: at MAX_SUPPLY 1 with 1 already minted, a MINT
            // would fail on headroom even with no lock at all, so "it was
            // refused" is not evidence that LOCK_MINT does anything. The
            // VERDICT is.
            const q = await quote('MINT', `0|${TICK}|1`, owner);
            expect(String(q.error || q.status), 'a locked collectible accepted a MINT')
                .toMatch(/LOCK_MINT/i);
        });

        await test.step('and the re-ISSUE inflation path is closed - by the protocol GATE, not by the token', async () => {
            // MINT_SUPPLY is credited on every valid ISSUE, and this re-ISSUE
            // omits MAX_SUPPLY so the locked-cap check never fires. The
            // template does not set LOCK_MINT_SUPPLY, so nothing on the token
            // itself refuses this: `ISSUE_MINT_SUPPLY_CUMULATIVE_CAP` does.
            //
            // Asserting the VERDICT rather than just the refusal is the point.
            // "MINT_SUPPLY exceeds MAX_SUPPLY" is the gate (issue.js ~388);
            // "MINT_SUPPLY (locked)" would be a token-level lock this template
            // has never written. If this assertion ever starts failing because
            // the message became the latter, the wallet-side fix under 
            // has landed and this comment is what says so.
            // MAX_SUPPLY is restated at its CURRENT value on purpose, and this
            // is the whole shape of the attack. Omitting it leaves
            // `data['MAX_SUPPLY']` null - it is never backfilled from
            // `tokenInfo` (only line ~337's lockCap does a local fallback) - so
            // the older single-shot `MINT_SUPPLY > MAX_SUPPLY` guard at ~371
            // catches it first and the gate is never reached. Restating it as 1
            // passes the locked-cap check at ~400 (equal, so not a change) and
            // passes ~371 (1 > 1 is false), which leaves the cumulative gate as
            // the only thing standing between a 1-of-1 and a 2-of-1.
            const q = await quote(
                'ISSUE',
                issueParams({ VERSION: 0, TICK, MAX_SUPPLY: 1, MINT_SUPPLY: 1 }),
                owner,
            );
            expect(String(q.error || q.status),
                'the owner can re-ISSUE fresh supply onto a 1-of-1 collectible: neither the token '
                + 'nor the venue stopped it')
                .toMatch(/MINT_SUPPLY exceeds MAX_SUPPLY/i);
        });

        await test.step('POSITIVE CONTROL: an unlocked field is still editable, so the refusals mean something', async () => {
            // Without this, a token that could not be edited at all - or a
            // venue refusing every ISSUE for an unrelated reason - would pass
            // all three steps above. This template locks the cap and minting
            // and deliberately leaves DESCRIPTION open.
            const q = await quote(
                'ISSUE',
                issueParams({ VERSION: 0, TICK, DESCRIPTION: `${IMAGE_URL}?v=2` }),
                owner,
            );
            expect(q.valid,
                'the collectible refuses an edit to a field it never locked, so the three '
                + 'refusals above are not attributable to the locks')
                .toBe(true);
        });

        await test.step('the wallet agrees with the chain: its own page offers no way to mint', async () => {
            // D-166's fix on a template it was not found on. `ManageToken`
            // gates Mint on `tokenLocks.mint`, which this token sets, so the
            // action must be absent from BOTH the button row and the More menu
            // - and scoped to `main`, because an unscoped "Lock" or "Mint"
            // match hits the shell's own chrome (§3.5, Session 39).
            await gotoPalette(page, 'Home');
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            // There is no "Manage token" palette command: the page is reached
            // by picking the token out of My Tokens.
            await gotoPalette(page, 'My Tokens');
            const main = page.getByRole('main');
            const row = main.getByRole('button').filter({ hasText: TICK }).first();
            await expect(row, `${TICK} is on chain but My Tokens does not list it`)
                .toBeVisible({ timeout: 60_000 });
            await row.click();
            await expect(page.getByRole('heading', { name: 'Manage Token' })
                .or(page.getByText('Manage Token').first()))
                .toBeVisible({ timeout: 30_000 });

            // Manage Token splits its actions between page BUTTONS and the More
            // menu, so both are checked; and the lookup is scoped to `main`
            // because the shell's own chrome carries same-named controls
            // (§3.5, Session 39).
            expect(await main.getByRole('button', { name: /^Mint$/ }).count(),
                'the owner\'s page offers Mint on a token whose LOCK_MINT the chain enforces')
                .toBe(0);
            const more = main.getByRole('button', { name: /^More/ });
            if (await more.count() > 0) {
                await more.first().click();
                expect(await page.getByRole('menuitem', { name: /^Mint$/ }).count(),
                    'the More menu offers Mint on a token whose LOCK_MINT the chain enforces')
                    .toBe(0);
            }
        });
    });
});
