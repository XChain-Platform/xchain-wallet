// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign acceptance test 3, and the LAST surface in the wallet that names two
// chains in one action: a cross-chain SWAP is composed, signed and broadcast on
// the GIVE chain, and the counterparty chain appears only as a coin name and a
// receiving address on the record.
//
// THE PAIR IS CHOSEN BY ASKING THE VENUE. The give chain is the one this run
// drives (XC_REGTEST_COIN); the get chain is the first OTHER regtest chain whose
// explorer knows the swap's token (`pickCounterparty`), and the test skips with
// the venue's own answer when no such chain exists. Nothing below drives the
// counterparty venue, mines it, or reads it beyond that one token probe, so the
// action is genuinely cross-chain while only the give chain is exercised.
//
// WHY THIS SPEC IS SMALLER THAN THE CAMPAIGN EXPECTED, measured at HEAD rather
// than assumed. The frontier row carried this as "a harness build before it is a
// spec" - a second-chain fixture, an address on the get chain, a way to activate
// it. Three of those four turned out to be already done:
//
//   - `switchToRegtest` derives an address on EACH chain of the network it
//     switches to, so the wallet has a get-chain address from the start and the
//     form's "Receive at" auto-fills from it (`getNewestAddress`).
//   - The form is two ordinary `ChainPicker`s plus two `TokenField`s, all four
//     of which the campaign's widget map already knows how to drive.
//   - The route is reachable from the command palette.
//
// What was genuinely missing is TWO helpers, not the one the row predicted, and
// they live in `fixtures/crossChain.js` with the reasoning: the venue-pinned
// helpers in `fixtures/regtest.js` close over ONE chain by construction, and
// `selectVenueSendAsset` anchors its trigger on `/^Token: /` while both fields
// here are named `Give token:` / `Get token:`.
//
// WHAT THE VENUE WAS ASKED BEFORE THIS FILE WAS WRITTEN, because two separate
// gates could have made the whole test unreachable and both are invisible from
// the wallet's source:
//
//   - A cross-chain SWAP is refused outright unless the CROSS_CHAIN_DEX
//     protocol change is active (`swap.js:146`). It is `addChange(...,0,...)`,
//     genesis-active on every network, and a live preflight of exactly these
//     params answers `valid: true`.
//   - SWEEP and CALLBACK price their protocol fee under Litecoin's dust floor,
//     which is a registered product defect and would have stopped this the same
//     way. SWAP is not in that class: its fee quote reads `requiredFeeSats: 0`.
//
// WHAT WOULD BE FALSE IF THIS PASSED VACUOUSLY. The screen is never its own
// witness:
//   - "Cross-chain swap broadcast" plus a txid is the WALLET reporting on
//     itself. The action is read back off the GIVE chain's explorer and must be
//     a `valid` SWAP, so an offer the handler rejected fails here rather than on
//     screen.
//   - The get half is asserted against the CHAIN's record, not the form: the
//     recorded get coin must be the counterparty's, which is the one field that
//     distinguishes this from the same-chain SWAP the wallet has always had.
//   - The receiving address is asserted to be shaped for the GET chain and NOT
//     to satisfy the give chain's shape. A form that auto-filled the give
//     chain's address would otherwise produce a perfectly valid-looking swap
//     that pays the counterparty on the wrong network.
//
// RUN IT ON ANOTHER GIVE CHAIN (Bitcoin is the default):
//   cd test/e2e && XC_REGTEST_COIN=RLTC npx playwright test \
//       --config=playwright.regtest.config.js tests/dex/cross-chain-swap.regtest.spec.js

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import { selectNamedChain, selectNamedToken } from '../../fixtures/crossChain.js';
import {
    explorerJson,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_ID,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    tokenBalance,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const TICK = 'XCHAIN';
/** Two fee-bearing broadcasts ride on this address: the mint and the swap. */
const FUNDING = 1;
const MINT = 500;
const GIVE_AMOUNT = '10';
const GET_AMOUNT = '5';

/**
 * The counterparty chains, and the coin ticker the PROTOCOL uses for each.
 *
 * Deliberately not derived from `REGTEST_COIN` alone: the give chain is
 * whatever the run drives, and the get chain has to be a DIFFERENT one that the
 * venue also serves. Each give chain lists every other regtest chain in order of
 * preference, and `pickCounterparty` takes the first one the venue can actually
 * quote, so a spec on Bitcoin pairs with Litecoin or Dogecoin and never offers a
 * swap to itself (which the form refuses anyway: "Give and get chains must
 * differ").
 *
 * `addressRe` is the get chain's shape and must NOT also match the give
 * chain's, which is why Litecoin is bech32-only here: its legacy `[mn2]`
 * prefixes are the same as Bitcoin's and Dogecoin's.
 */
const CHAINS = {
    RBTC: { explorerCoin: 'RBTC', chainId: 'bitcoin-regtest', chainLabel: 'Bitcoin', coin: 'BTC', addressRe: /^bcrt1/ },
    RLTC: { explorerCoin: 'RLTC', chainId: 'litecoin-regtest', chainLabel: 'Litecoin', coin: 'LTC', addressRe: /^rltc1/ },
    RDOGE: { explorerCoin: 'RDOGE', chainId: 'dogecoin-regtest', chainLabel: 'Dogecoin', coin: 'DOGE', addressRe: /^[mn2]/ },
};
const COUNTERPARTIES = {
    RBTC: [CHAINS.RLTC, CHAINS.RDOGE],
    RLTC: [CHAINS.RDOGE, CHAINS.RBTC],
    RDOGE: [CHAINS.RLTC, CHAINS.RBTC],
};

/**
 * Asks the venue which counterparty chain can carry the GET half, before any UI.
 *
 * The get token is chosen through the picker's platform discovery, which is a
 * token search against the GET chain's own explorer. So a counterparty is only
 * usable when that explorer answers for the swap's tick there: a second chain the
 * venue runs without the token deployed would fail several screens in, on "the
 * asset picker lists no XCHAIN", reading like a wallet defect. Returns the first usable
 * chain, or the venue's answer for every candidate so the skip says why.
 */
async function pickCounterparty() {
    const refusals = [];
    for (const chain of COUNTERPARTIES[REGTEST_COIN] || []) {
        try {
            const body = await explorerJson(`token/${TICK}`, { coin: chain.explorerCoin });
            if (String(body?.info?.tick || '').toUpperCase() === TICK) return { chain, gap: null };
            refusals.push(`${chain.explorerCoin} answered with no ${TICK} token record`);
        } catch (err) {
            refusals.push(`${chain.explorerCoin}: ${String(err?.message || err).split('\n')[0]}`);
        }
    }
    if (refusals.length === 0) refusals.push(`no counterparty chain is listed for ${REGTEST_COIN}`);
    return { chain: null, gap: refusals.join('; ') };
}

/**
 * Reads one swap field off an action detail, across both nestings.
 *
 * THIS IS THE CAMPAIGN'S OWN MOST EXPENSIVE CLASS, GUARDED AT THE READ SITE.
 * The explorer projects per-action fields under a `details` sub-object on some
 * routes and at the top level on others, and three separate runs of this
 * campaign have now spent hours chasing a wrong cause because an ABSENT field
 * was read as a verdict about the chain. So this never returns a default: if
 * neither nesting carries the field it throws naming the keys that ARE there,
 * which turns "the chain did not record a get coin" into "this reader is
 * looking in the wrong place", and those are very different bugs.
 */
function swapField(detail, field) {
    const flat = detail?.[field];
    const nested = detail?.details?.[field];
    const value = flat != null ? flat : nested;
    if (value == null) {
        throw new Error(
            `the action detail carries no "${field}" at either nesting. Top-level keys: `
            + `[${Object.keys(detail || {}).join(', ')}]; details keys: `
            + `[${Object.keys(detail?.details || {}).join(', ')}]. This is a reader problem, `
            + 'not a verdict about what the chain recorded');
    }
    return value;
}

test.describe(`cross-chain SWAP from ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('an offer composed on the give chain records the counterparty chain and settles nothing yet', async ({ page }) => {
        // Venue capability, asked before any UI: a cross-chain swap needs a
        // second chain whose explorer knows the get token. Wherever one exists
        // this runs; a venue with only the give chain carrying it skips with
        // the venue's own answer.
        const { chain: GET, gap } = await pickCounterparty();
        test.skip(!GET, `this venue has no second chain that can carry the get half of a ${TICK} `
            + `swap from ${REGTEST_COIN}: ${gap}`);

        let source;

        await test.step('give the wallet a token balance on the give chain', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Swap Offerer' });
            await switchToRegtest(page, PASSWORD);

            source = await readReceiveAddress(page);
            expect(source, `Receive handed back an address that is not shaped for ${REGTEST_CHAIN_LABEL}`)
                .toMatch(REGTEST_ADDRESS_RE);

            // The reload/unlock pair after each funding step is not ceremony:
            // it is the sequence `a11y/confirm-a11y` proved green on this venue,
            // and the wallet re-reads its balances on load. Minting against a
            // shell that has not seen the funding fails at the confirm surface
            // with nothing on screen to say why.
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await mintXchain(page, MINT);
            await waitForTokenBalance(source, TICK, MINT);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('compose the offer: give on this chain, get on the counterparty chain', async () => {
            await openPaletteCommand(page, 'Cross-chain swap');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: /^Give network:/ }),
                'the palette did not land on the cross-chain swap form')
                .toBeVisible({ timeout: 30_000 });

            // The GIVE half follows the venue, so it takes the venue-pinned
            // helper; the GET half is deliberately NOT the venue's chain and
            // takes the named one. Using the venue helper on both is the silent
            // failure this pair of helpers exists to make impossible - the form
            // refuses a swap whose chains match, so it would fail on a
            // validation message rather than on anything cross-chain.
            await selectVenueChain(main, 'Give network');
            await selectNamedChain(main, 'Get network', GET.chainLabel);

            // CHAINS BEFORE TOKENS, and the order is load-bearing rather than
            // tidy: each token picker is opened with
            // `networkFilter={coinFromChainId(...)}` taken from its own side's
            // chain (`:593`, `:609`), so a picker opened before the chain is
            // set is filtered to the wrong network and the row this spec asks
            // for is simply absent. The pickers only ever set the TICK back
            // (`:595`, `:611`), so neither one re-targets a chain already
            // chosen - which is why picking both chains up front is safe.
            await selectNamedToken(page, 'Give token', {
                chainId: REGTEST_CHAIN_ID, chainLabel: REGTEST_CHAIN_LABEL, tick: TICK,
            });
            await selectNamedToken(page, 'Get token', {
                chainId: GET.chainId, chainLabel: GET.chainLabel, tick: TICK,
            });

            await main.getByLabel('Give amount').fill(GIVE_AMOUNT);
            await main.getByLabel('Get amount').fill(GET_AMOUNT);
        });

        let receiveAt;

        await test.step('the receiving address is on the GET chain, not this one', async () => {
            const main = page.getByRole('main');
            const field = main.getByLabel('Receive at');
            await expect(field, 'the form never auto-filled a receiving address on the get chain; '
                + 'a wallet derives an address on every chain of the network it switches to, so an '
                + 'empty field here means that derivation did not happen')
                .not.toHaveValue('', { timeout: 30_000 });
            receiveAt = await field.inputValue();

            // The claim that makes this cross-chain rather than decorative. A
            // form auto-filling the GIVE chain's address would compose a swap
            // that looks right on every screen and pays the counterparty on the
            // wrong network, so both directions are asserted.
            expect(receiveAt, `"Receive at" is not shaped for ${GET.chainLabel}`)
                .toMatch(GET.addressRe);
            expect(receiveAt, `"Receive at" holds the GIVE chain's own address (${receiveAt}), so the `
                + 'counterparty would be told to pay on the wrong chain')
                .not.toBe(source);
        });

        await test.step('review names both chains, then sign', async () => {
            const main = page.getByRole('main');
            await main.getByRole('button', { name: 'Review', exact: true }).click();

            await expect(main, 'the Review button did not reach the review stage')
                .toContainText(/Offer to give/, { timeout: 30_000 });
            await expect(main).toContainText(
                new RegExp(`Offer to give ${GIVE_AMOUNT} ${TICK} in exchange for ${GET_AMOUNT} ${TICK}`));
            // The review names each network through a badge whose accessible name
            // is the network's display name, beside its "Give network" and "Get
            // network" rows.
            await expect(main.getByRole('img', { name: REGTEST_CHAIN_LABEL, exact: true }).first())
                .toBeVisible();
            await expect(main.getByRole('img', { name: GET.chainLabel, exact: true }).first())
                .toBeVisible();

            // CONDITIONAL, and not out of caution: `SignCredentials` renders
            // no password field at all when the signer pool is already
            // rehydrated, showing "Wallet unlocked. No password needed."
            // instead, and the form's submit gate agrees (`!signerReady &&
            // password.length === 0`). An unconditional fill would wait out the
            // full budget on a screen that is ready to sign. Same shape the
            // betting lane settled on.
            const password = main.getByLabel('Password', { exact: true });
            if (await password.count() > 0 && await password.isVisible()) {
                await password.fill(PASSWORD);
            }
            await main.getByRole('button', { name: 'Sign cross-chain swap' }).click();
        });

        let txid;

        await test.step('the wallet reports a give-network broadcast', async () => {
            const main = page.getByRole('main');
            await expect(main, 'no broadcast screen ever appeared after signing')
                .toContainText('Cross-chain swap broadcast', { timeout: 180_000 });
            await expect(main).toContainText(/[0-9a-f]{64}/, { timeout: 60_000 });
            txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
            expect(txid, 'the broadcast screen showed no transaction id').toBeTruthy();

            // The offer is open, not settled: the wallet must not claim the
            // counterparty leg has happened, because nothing on the get chain
            // has been driven at all.
            await expect(main).toContainText(new RegExp(`settles atomically when a counterparty fills it on\\s+the get network`));
        });

        await test.step('the GIVE chain records a valid SWAP carrying the counterparty coin', async () => {
            // Read off the give chain, which is the only chain this spec drives.
            // `waitForValidAction` asserts the status itself, so a swap the
            // handler refused fails here with the chain's own verdict.
            const detail = await waitForValidAction(txid);

            expect(String(detail.action),
                'the give chain recorded something other than a SWAP for this transaction')
                .toBe('SWAP');

            expect(String(swapField(detail, 'give_coin')),
                'the recorded give coin is not this venue\'s').toBe(
                REGTEST_COIN.replace(/^R/, ''));
            expect(String(swapField(detail, 'get_coin')),
                'the recorded get coin is not the counterparty chain\'s, so this swap is not '
                + 'cross-chain on the record no matter what the form showed')
                .toBe(GET.coin);
            expect(String(swapField(detail, 'give_tick')).toUpperCase()).toBe(TICK);
            expect(String(swapField(detail, 'get_tick')).toUpperCase()).toBe(TICK);

            // Independent of the screen: the address the counterparty is told
            // to pay must be the one the form auto-filled, on the get chain.
            const recorded = String(swapField(detail, 'get_address'));
            expect(recorded, 'the chain recorded a different receiving address than the one on screen')
                .toBe(receiveAt);
        });

        await test.step('the give side is escrowed, and only the give side', async () => {
            // THE GIVE SIDE MOVES AT COMPOSE TIME, and it is tempting to assert
            // the opposite. `SWAP.md` is explicit about it: "Cross-chain swaps
            // (GET_COIN != the posting chain) escrow the GIVE side locally" and
            // settle from that escrow when the hub mirror matches the two legs -
            // there is no per-trade transaction to move it later, so an offer
            // that left the balance spendable could be spent twice.
            //
            // The old assertion (`.toBe(MINT)`) read "an OFFER escrows nothing on
            // this chain", which is true of a SAME-chain order book and not of
            // this action, and it went unnoticed for as long as the file could
            // not be driven. It is the wrong direction to be wrong in: it demands
            // that the chain leave money spendable while it is committed
            // elsewhere, so a wallet that broke escrow would pass it.
            // POLLED, not read once. The step above proves the ACTION is on the
            // record; the debit is applied by the indexer and is not guaranteed
            // to be visible in the same instant. Runs 8 and 9 of this campaign
            // both failed here on `Expected 490, Received 500` while the venue,
            // read minutes later, held exactly 490 - so the single read was
            // seeing the pre-debit number and reporting it as "the swap escrowed
            // nothing at all", which sent two run reports after a defect that was
            // not there.
            //
            // `waitForTokenBalance` is the wrong tool and that is worth saying:
            // it waits for a MINIMUM, and this balance goes DOWN, so 500 already
            // satisfies a floor of 490 and it would return instantly on the very
            // number this step exists to reject.
            const escrowed = MINT - Number(GIVE_AMOUNT);
            const deadline = Date.now() + 120_000;
            let held = null;
            while (Date.now() < deadline) {
                held = await tokenBalance(source, TICK);
                if (Number(held) === escrowed) break;
                await new Promise((r) => setTimeout(r, 3_000));
            }
            expect(Number(held),
                `composing the offer should have escrowed exactly ${GIVE_AMOUNT} ${TICK} of the `
                + `offerer's ${MINT}; a different number means the swap escrowed the wrong side, `
                + 'the wrong amount, or nothing at all')
                .toBe(escrowed);
        });
    });
});
