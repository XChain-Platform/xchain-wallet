// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Create token" -> LIMITED EDITION, and "Mint (add
// supply)" -> the public-mint window. Neither has ever been driven.
//
// WHAT MAKES THIS LANE DIFFERENT FROM EVERY OTHER ISSUE. The edition template
// is the wallet's only fair-mint composer: it writes MAX_SUPPLY but NOT
// MINT_SUPPLY, so the genesis transaction creates a token the issuer holds
// NONE of, and then four separate consensus bounds decide who may mint it and
// when. All four are enforced in `mint.js` with their own verdicts:
//
//   AMOUNT > MAX_MINT               per-TRANSACTION cap
//   mint exceeds MINT_ADDRESS_MAX   cumulative cap per minting ADDRESS
//   MINT_START_BLOCK                the window has not opened
//   MINT_STOP_BLOCK                 the window has closed
//
// Every one of those numbers is typed into a wizard field once, at genesis,
// and `LOCK_MAX_SUPPLY` is set in the same params - so a wrong one is not a
// mistake the issuer can correct afterwards, and it gates other people's money
// rather than their own.
//
// WHY THE HEADROOM IS THE INTERESTING PART. already fixed this form's
// Max button and its "available to mint" footer once: they used to be sized off
// the minter's BALANCE, so a token at its cap offered a Max the chain rejects
// by construction. The fix was `mintHeadroom({ maxSupply, totalSupply,
// mintMax })` - three of the six bounds. The other three (the address cap and
// the two window blocks) are read by the same `tokenInfo` call, in the same
// object, and are not consulted. So the question this spec asks is not "does
// the chain enforce the window" (it does) but "what does the wallet say while
// the window is shut", and the answer is asserted against the chain rather
// than reasoned about.
//
// WHERE THE REFUSALS ARRIVE, corrected by the run rather than reasoned: the LTC
// gas schedule has no MINT key, so this action carries no protocol fee - and
// the native-fee pre-flight STILL blocks it on the FORM, because it asks the
// venue to quote and the venue answers `invalid: <verdict>` with no fee at
// all. So a refused mint never reaches the confirm screen and cannot be
// broadcast over the wallet's objection the way a refused SEND can. That is
// good behaviour - nothing is signed and nothing is spent - and it means the
// chain-side control here is `/feequote`, which runs the real handler, rather
// than a broadcast. Same shape as subtokens one lane over (D-163).
//
// RUN IT ON LITECOIN:
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/tokens/edition-mint-window.regtest.spec.js

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
/** The ISSUE pays a real coin fee; the MINTs pay only miner fees. */
const FUNDING = 3;
const STAMP = Date.now().toString().slice(-6);
const TICK = `EDT${STAMP}`;
/** MAX_SUPPLY. Nothing is minted at genesis - that is the template's whole point. */
const EDITION = 100;
/** MAX_MINT: the per-transaction cap. */
const PER_TX = 10;
/** MINT_ADDRESS_MAX: the cumulative cap for any one minting address. */
const PER_ADDRESS = 20;
/**
 * How far ahead of the tip the window opens.
 *
 * Wide enough that the ISSUE (1-2 blocks) and the too-early MINT (1-2 more)
 * both land while it is still shut; anything tighter and the first leg passes
 * for the wrong reason, on a window that opened underneath it.
 */
const OPENS_IN = 8;
/** Far enough that nothing in test 1 can reach it; the STOP gate is test 2. */
const WINDOW_LENGTH = 500;
/** Test 2's token: no start block at all, and a stop this run deliberately crosses. */
const TICK_CLOSING = `EDC${STAMP}`;
/**
 * How long test 2's window stays open.
 *
 * Three mints have to land inside it (two from one address, one from another),
 * each costing a block or two, and the run then mines PAST it on purpose.
 */
const CLOSES_IN = 40;

const explorerJson = async (path) => {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`);
    if (!res.ok) throw new Error(`explorer ${path} -> ${res.status}`);
    return res.json();
};

async function chainTip() {
    const status = await explorerJson('status');
    return Number(status.chain_tip[REGTEST_COIN]);
}

/**
 * The venue's own verdict on minting `amount` of TICK from `source`, taken
 * without the wallet.
 *
 * A refused mint never reaches the confirm screen (the native-fee pre-flight
 * answers on the form), so there is no broadcast to read a status off - and a
 * spec that only asserted the wallet's own message would be checking the wallet
 * against itself. The quote runs the real handler, which is what makes this an
 * independent control rather than a second opinion from the same source.
 */
async function feeQuote(amount, source, tick = TICK) {
    const url = new URL(`${EXPLORER_URL}/${REGTEST_COIN}/api/feequote`);
    url.searchParams.set('action', 'MINT');
    url.searchParams.set('params', `0|${tick}|${amount}`);
    url.searchParams.set('source', source);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`feequote MINT ${tick} ${amount} -> ${res.status}`);
    return res.json();
}

/**
 * Waits until the height the WALLET reads has reached `height`.
 *
 * `messaging.getIndexerWatermark` answers with the INDEXER's processed height,
 * not the node's tip, so a run that mines forty blocks in one call is ahead of
 * the wallet for as long as the pipeline takes to catch up. Asserting a closed
 * window against a wallet that has not seen the closing block yet would be
 * asserting the lag, not the feature.
 */
async function waitForIndexedHeight(height, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const status = await explorerJson('status').catch(() => null);
        last = Number(status?.decoder_tip?.[REGTEST_COIN] ?? 0);
        const lag = Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 99);
        if (last >= height && lag === 0) return last;
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`the indexer never reached block ${height} (last ${last})`);
}

/** Mines only when something is waiting for a block (§3.5, Session 29). */
async function mineIfPending() {
    try {
        const status = await minerRpc('status', {});
        if (Number(status?.mempool_size ?? 0) > 0) await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient while a block lands */ }
}

/** Mines deliberately until the tip reaches `height`, which is what opens a window. */
async function mineUntil(height) {
    for (let i = 0; i < 60; i += 1) {
        const tip = await chainTip();
        if (tip >= height) return tip;
        await minerRpc('generate_blocks', { count: Math.min(5, height - tip) });
        await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`the chain never reached block ${height}`);
}

/**
 * Waits for the action carrying `txid` and returns its record. Waits on the
 * action LIST and fetches a detail only for an index the list already returned
 * (§3.6: a speculative GET of a future index is memoised blank forever).
 */
async function waitForIndexedAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const list = await explorerJson('actions?limit=100').catch(() => null);
        const row = (list?.data || []).find((r) => r.tx_hash === txid);
        if (row) return explorerJson(`action/${row.action_index}`);
        await mineIfPending();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    const status = await explorerJson('status').catch(() => null);
    throw new Error(`No XChain action recorded for ${txid} within `
        + `${Math.round(timeoutMs / 1000)}s. Decoder lag `
        + `${status?.decoder_lag_blocks?.[REGTEST_COIN]}, indexer lag `
        + `${status?.chain_lag_blocks?.[REGTEST_COIN]}.`);
}

/** Waits for `tick` at `address` to read exactly `want`. */
async function waitForBalance(address, tick, want, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await tokenBalance(address, tick).catch(() => last);
        if (last === want) return last;
        await mineIfPending();
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

/** Reloads onto a clean, unlocked Home (§3.5: navigate FIRST, then reload). */
async function reloadToHome(page) {
    await gotoPalette(page, 'Home');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
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

/**
 * Generates one address on the venue chain and returns it.
 *
 * Identified by DIFFERENCE against a snapshot rather than by prefix: BTC and
 * LTC regtest share the legacy m/n/2 version bytes and DOGE has no bech32 form,
 * so "the one that looks like this chain's" is ambiguous on exactly these
 * venues (§3.5). The modal has its OWN coin picker, labelled "Coin".
 */
async function generateVenueAddress(page) {
    await gotoPalette(page, 'Addresses');
    const listed = async () => {
        const rows = page.getByRole('button', { name: /^View address / });
        await expect(rows.first()).toBeVisible({ timeout: 30_000 });
        return (await Promise.all((await rows.all()).map((r) => r.getAttribute('aria-label'))))
            .map((l) => String(l).replace('View address ', ''))
            .filter(Boolean);
    };
    const before = new Set(await listed());

    await page.getByRole('button', { name: 'Add or import address' }).click();
    await page.getByRole('menuitem', { name: 'Add address' }).click();
    await selectVenueChain(page, 'Coin');
    await page.getByRole('button', { name: /^Generate/ }).click();

    const generated = (await listed()).filter((a) => !before.has(a));
    expect(generated.length, 'generating added exactly one address to the list').toBe(1);
    return generated[0];
}

/** Opens the Mint form's token picker and selects `tick`. */
async function pickToken(page, tick) {
    await page.getByRole('button', { name: /^Token:/ }).click();
    await expect(page.getByLabel('Search coins or tokens'),
        'the Select token screen never opened').toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Search coins or tokens').fill(tick);
    const row = page.getByLabel(new RegExp(`Open ${tick} details`, 'i')).first();
    await expect(row,
        `the token picker cannot reach ${tick}. It runs the platform-wide discovery for exactly `
        + 'this case - an edition the issuer holds none of (D-41)')
        .toBeVisible({ timeout: 30_000 });
    await row.click();
}

/**
 * Fills the Mint form for `amount` of TICK and submits it, returning the
 * "available to mint" footer the form showed while doing so.
 *
 * The footer is captured rather than merely asserted because it is the claim
 * under test: it is the only number this screen offers about what the chain
 * will accept, and the Max button sets exactly it.
 */
async function composeMint(page, amount, tick = TICK, signAs = null) {
    await reloadToHome(page);
    await gotoPalette(page, 'Mint supply');
    const main = page.getByRole('main');
    // The label GAINS the ticker once a token is picked ("Amount" -> "Amount (EDT123)"),
    // so an exact match works before the pick and never after it.
    await expect(main.getByRole('textbox', { name: /^Amount/ })).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    await pickToken(page, tick);

    // `useActionForm` defaults From to the chain's ACTIVE address, falling back
    // to the newest HD one - so generating an address does NOT move this form's
    // signer the way it moves the wizard's (D-163). A second minter has to be
    // chosen, which is what the picker is for.
    if (signAs) {
        await page.getByRole('button', { name: 'Choose source address' }).click();
        const row = page.getByRole('button', { name: `View address ${signAs}` });
        await expect(row, `the source picker does not offer ${signAs}`)
            .toBeVisible({ timeout: 30_000 });
        await row.click();
        await expect(page.getByLabel('From')).toHaveValue(signAs, { timeout: 30_000 });
    }

    // The AmountField's balance line, whatever it currently says: it carries the
    // headroom, the per-address cap and the window notice at different moments,
    // and a regex that only knew the first of those reported the fix as absent.
    const footer = await main
        .getByText(/available to mint|No supply cap|opens at block|closed at block/).first()
        .innerText().catch(() => '');

    await main.getByRole('textbox', { name: /^Amount/ }).fill(String(amount));
    await main.getByRole('button', { name: 'Mint', exact: true }).click();
    return footer;
}

/**
 * Onboards, funds the wallet's only address and creates the edition through
 * the wizard. Returns { source, startBlock, stopBlock }.
 */
async function onboardAndCreateEdition(page, {
    walletName = 'Edition Wallet', tick = TICK, opensIn = OPENS_IN, closesIn = null,
} = {}) {
    await createWallet(page, { password: PASSWORD, name: walletName });
    await switchToRegtest(page, PASSWORD);

    await gotoPalette(page, 'Issue token');
    const probe = page.getByRole('main');
    await expect(probe.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(probe);
    const source = await probe.getByLabel('From').inputValue();
    expect(source, `the wallet has no ${REGTEST_CHAIN_LABEL} address to sign with`)
        .toMatch(REGTEST_ADDRESS_RE);

    await fundAddress(source, FUNDING);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    await seedPrices();

    const tip = await chainTip();
    // `opensIn: null` leaves MINT_START_BLOCK unset, which is a different token
    // shape rather than a shortcut: one bound set and the other not is the
    // common case for a drop that opens immediately and ends on a deadline.
    const startBlock = opensIn === null ? null : tip + opensIn;
    const stopBlock = closesIn === null
        ? (startBlock === null ? null : startBlock + WINDOW_LENGTH)
        : tip + closesIn;

    await gotoPalette(page, 'Create a token');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: /^Limited edition/ }).click();
    await selectVenueChain(main);
    await main.getByRole('button', { name: 'Next', exact: true }).click();

    await expect(main.getByLabel('Token name (ticker)')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Token name (ticker)').fill(tick);
    await main.getByLabel('Edition size').fill(String(EDITION));
    await main.getByLabel('Copies per mint').fill(String(PER_TX));
    await main.getByLabel('Limit per address (optional)').fill(String(PER_ADDRESS));
    if (startBlock !== null) {
        await main.getByLabel('Minting opens at block (optional)').fill(String(startBlock));
    }
    if (stopBlock !== null) {
        await main.getByLabel('Minting closes at block (optional)').fill(String(stopBlock));
    }
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

    await expectConfirmScreen(page);
    const issued = await waitForIndexedAction(await approveAndGetTxid(page));
    expect(String(issued.status),
        `the venue rejected the ${tick} genesis (${issued.status})`)
        .toBe('valid');

    return { source, startBlock, stopBlock };
}

test.describe(`limited-edition mint window on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(2_400_000);

    test('the window and the two caps are enforced, and each refusal names itself', async ({ page }) => {
        let source;
        let startBlock;
        let stopBlock;

        await test.step('onboard, fund, and create the edition', async () => {
            ({ source, startBlock, stopBlock } = await onboardAndCreateEdition(page));
        });

        await test.step('genesis mints NOTHING, and the chain stored all four bounds', async () => {
            const token = await explorerJson(`token/${TICK}`);
            // `supply` is an object here - `{ current, max, decimals }` - not a
            // scalar. Reading it as a number answers NaN, which is not 0 and is
            // not a defect either; cost a run.
            expect(Number(token?.supply?.current),
                'the edition genesis minted supply, so it is not the fair-mint template it claims '
                + 'to be - MINT_SUPPLY was written when only MAX_SUPPLY should have been')
                .toBe(0);
            expect(await tokenBalance(source, TICK),
                'the issuer holds supply of an edition nobody has minted yet')
                .toBe(0);

            const mints = token?.mints || {};
            expect(Number(mints.max), 'MAX_MINT did not reach the chain').toBe(PER_TX);
            expect(Number(mints.address_max), 'MINT_ADDRESS_MAX did not reach the chain')
                .toBe(PER_ADDRESS);
            expect(Number(mints.start_block), 'MINT_START_BLOCK did not reach the chain')
                .toBe(startBlock);
            expect(Number(mints.stop_block), 'MINT_STOP_BLOCK did not reach the chain')
                .toBe(stopBlock);
        });

        await test.step('BEFORE the window opens: the form says WHEN, and never asks the network', async () => {
            expect(await chainTip(),
                'the window opened before this leg could run it; widen OPENS_IN')
                .toBeLessThan(startBlock);

            // The chain's own answer, taken independently of the wallet, so
            // that what follows is attributable to the window and not to the
            // wallet agreeing with itself.
            const quote = await feeQuote(PER_TX, source);
            expect(String(quote.status)).toMatch(/MINT_START_BLOCK/i);

            const footer = await composeMint(page, PER_TX);

            // D-164(a). The footer that sizes the Max button used to read
            // "10 EDT... available to mint" while the network was refusing
            // exactly that amount on the same screen. `mintHeadroom` takes
            // maxSupply, totalSupply and mintMax; mintStartBlock rides in the
            // same `tokenInfo` object, unread.
            expect(footer, 'the amount field still advertises supply while the window is shut')
                .toMatch(new RegExp(`opens at block ${startBlock}`));
            expect(footer, 'the window notice does not say the network refuses mints until then')
                .toMatch(/refuses mints until then/i);

            // D-164(b). The generic pre-flight sentence for an unrecognised
            // verdict asserts "Waiting will not change this" - which is false
            // for exactly this one, whose entire remedy is to wait for a block
            // the wallet can name. The form now answers before the network is
            // asked, so that sentence is never reached.
            const alert = page.getByRole('alert').first();
            await expect(alert, 'the form composed a mint the window forbids')
                .toBeVisible({ timeout: 30_000 });
            await expect(alert).toContainText(new RegExp(`opens at block ${startBlock}`));
            await expect(alert,
                'the refusal still tells a user that waiting will not change a gate that opens by '
                + 'itself at a known block')
                .not.toContainText(/Waiting will not change this/i);

            // Nothing signed, nothing sent, nothing minted.
            expect(await page.getByTestId('confirm-modal').count(),
                'a mint the window forbids reached the confirm screen')
                .toBe(0);
            expect(await tokenBalance(source, TICK)).toBe(0);
        });

        await test.step('the per-transaction cap is pre-blocked client-side, before any broadcast', async () => {
            await mineUntil(startBlock);

            // that guard on the dimension it does cover: `mintHeadroom`
            // takes MAX_MINT, so an amount over the per-tx cap never composes.
            // Asserted as a NEGATIVE, because a client-side block that composed
            // anyway would be worse than none.
            await composeMint(page, PER_TX + 1);
            await expect(page.getByRole('alert').first(),
                'the form accepted an amount above MAX_MINT without a word')
                .toBeVisible({ timeout: 30_000 });
            expect(await page.getByTestId('confirm-modal').count(),
                'an amount the chain refuses by construction reached the confirm screen')
                .toBe(0);
        });

        await test.step('INSIDE the window: two mints of the cap settle, taking the address to its limit', async () => {
            for (const expected of [PER_TX, PER_TX * 2]) {
                await composeMint(page, PER_TX);
                await expectConfirmScreen(page);
                await expect(page.getByTestId('preflight-panel'))
                    .not.toHaveAttribute('data-verdict', 'fail');

                const action = await waitForIndexedAction(await approveAndGetTxid(page));
                expect(String(action.status),
                    'the chain refused a mint inside the window, at the per-transaction cap, '
                    + 'below the per-address cap')
                    .toBe('valid');
                await waitForBalance(source, TICK, expected);
            }
        });

        await test.step('PAST the address cap: refused again, and the footer still offers a full transaction', async () => {
            const quote = await feeQuote(PER_TX, source);
            expect(String(quote.status)).toMatch(/MINT_ADDRESS_MAX/i);

            const footer = await composeMint(page, PER_TX);

            // The second missing dimension. This address has minted its whole
            // MINT_ADDRESS_MAX and can never mint another unit of this token;
            // the footer is sized off min(MAX_MINT, MAX_SUPPLY - supply), and
            // 80 of the 100 edition remains, so it advertises a full ten.
            // The per-address cap cannot become a remaining figure - it is
            // cumulative over this address's whole MINT history and nothing the
            // wallet reads carries that total - so it is STATED beside the
            // headroom rather than subtracted from it. A form that silently
            // offered ten again, with this address permanently unable to mint
            // one, is what this replaces.
            expect(footer, 'the amount field says nothing about the per-address cap')
                .toMatch(new RegExp(`${PER_TX} ${TICK} available to mint, ${PER_ADDRESS} per address in total`));

            await expect(page.getByRole('alert').filter({ hasText: /MINT_ADDRESS_MAX/i }),
                'the wallet did not quote the network\'s verdict for the per-address cap')
                .toBeVisible({ timeout: 90_000 });
            expect(await page.getByTestId('confirm-modal').count(),
                'a mint past the address cap reached the confirm screen')
                .toBe(0);
            expect(await tokenBalance(source, TICK),
                'the refused mint credited the minter anyway')
                .toBe(PER_TX * 2);
        });
    });

    test('the address cap is per ADDRESS, and the window closes for everyone', async ({ page }) => {
        let issuer;
        let second;
        let stopBlock;

        await test.step('create an edition that is open from genesis and ends on a deadline', async () => {
            ({ source: issuer, stopBlock } = await onboardAndCreateEdition(page, {
                walletName: 'Edition Cap Wallet',
                tick: TICK_CLOSING,
                opensIn: null,
                closesIn: CLOSES_IN,
            }));
        });

        await test.step('the first address mints to its cap', async () => {
            for (const expected of [PER_TX, PER_TX * 2]) {
                await composeMint(page, PER_TX, TICK_CLOSING);
                await expectConfirmScreen(page);
                const action = await waitForIndexedAction(await approveAndGetTxid(page));
                expect(String(action.status), 'a mint inside an open window was refused')
                    .toBe('valid');
                await waitForBalance(issuer, TICK_CLOSING, expected);
            }

            // Exhausted, and the chain says so - the control that makes the
            // next step mean something.
            const quote = await feeQuote(PER_TX, issuer, TICK_CLOSING);
            expect(String(quote.status)).toMatch(/MINT_ADDRESS_MAX/i);
        });

        await test.step('a SECOND address mints the same token in the same window', async () => {
            second = await generateVenueAddress(page);
            expect(second).not.toBe(issuer);
            await fundAddress(second, FUNDING);
            await reloadToHome(page);

            // THE PROPERTY THE CAP EXISTS FOR, and the only way to prove it.
            // Everything up to here is equally consistent with MINT_ADDRESS_MAX
            // being a per-TOKEN cap that happened to be reached: same token,
            // same window, same amount, 20 already minted - the only thing that
            // changes is who is asking, and the answer flips.
            const quote = await feeQuote(PER_TX, second, TICK_CLOSING);
            expect(String(quote.status),
                'the venue refuses a fresh address too, so the cap is not per-address at all')
                .toBe('valid');

            await composeMint(page, PER_TX, TICK_CLOSING, second);
            await expectConfirmScreen(page);
            const action = await waitForIndexedAction(await approveAndGetTxid(page));
            expect(String(action.status),
                'the chain refused a fresh address minting under a cap it has not touched')
                .toBe('valid');
            await waitForBalance(second, TICK_CLOSING, PER_TX);

            // And the first address is untouched by the second's mint: the two
            // allowances are separate, not a shared pool drawn down.
            expect(await tokenBalance(issuer, TICK_CLOSING)).toBe(PER_TX * 2);
        });

        await test.step('past MINT_STOP_BLOCK the form closes the door, for the address that could still mint', async () => {
            await mineUntil(stopBlock + 1);
            // The wallet reads the INDEXER's height, not the node's tip, so the
            // window is not shut as far as the form is concerned until the
            // pipeline has caught up. Asserting before that measures the lag.
            await waitForIndexedHeight(stopBlock + 1);

            const quote = await feeQuote(PER_TX, second, TICK_CLOSING);
            expect(String(quote.status)).toMatch(/MINT_STOP_BLOCK/i);

            // Deliberately the SECOND address: it has minted 10 of its 20, so
            // nothing about its own allowance stops it. The only thing that
            // changed is the block.
            const footer = await composeMint(page, PER_TX, TICK_CLOSING, second);
            expect(footer, 'the form still advertises supply after the edition has closed')
                .toMatch(new RegExp(`closed at block ${stopBlock}`));

            const alert = page.getByRole('alert').first();
            await expect(alert, 'the form composed a mint into a closed window')
                .toBeVisible({ timeout: 30_000 });
            await expect(alert).toContainText(/No more can be minted/i);
            expect(await page.getByTestId('confirm-modal').count(),
                'a mint past the edition\'s deadline reached the confirm screen')
                .toBe(0);
            expect(await tokenBalance(second, TICK_CLOSING),
                'the closed-window mint credited the minter anyway')
                .toBe(PER_TX);
        });
    });
});
