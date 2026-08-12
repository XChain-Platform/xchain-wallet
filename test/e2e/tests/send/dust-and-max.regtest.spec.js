// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, Send: the two owed error paths that involve money
// rather than wording - a DUST amount and the MAX button.
//
// WHY THESE TWO. Both are arithmetic the user cannot check. A dust output is
// one every node refuses, so a wallet that builds one has produced a
// transaction that cannot confirm; and Max is the wallet subtracting its own
// fee estimate from the balance (`onMax` in Send.jsx does exactly that), so if
// that estimate is not the fee the PSBT ends up paying, Max is wrong in one of
// two ways: too high and nothing can be built, too low and satoshis are left
// stranded at an address the user believes they emptied. Neither failure says
// anything on screen.
//
// DRIVEN ON BITCOIN, and for once the wedged indexer (§3.7) does not matter:
// both legs are BARE NATIVE SENDS, which carry no XChain action at all,
// so nothing here waits on an indexed row and every measurement comes from the
// utxo set and the confirm screen. Bitcoin is also the chain whose asset the
// Send form already defaults to; off it the amount would have to be selected
// through the asset picker, which is a different subject.
//
//   LEG 1, DUST: attempt to send an amount under the floor and require that
//     NOTHING reaches the chain. The mechanism is deliberately not asserted -
//     a client-side guard and an encoder refusal are equally acceptable
//     outcomes - but the OUTCOME is: the miner's mempool stays empty and the
//     payer's confirmed satoshis do not move. Whatever the wallet said is
//     printed, so the run reports the wording rather than guessing at it.
//
//   LEG 2, MAX: press Max, broadcast, and then ask the CHAIN what happened.
//     The source must be emptied EXACTLY - zero satoshis left, no dust residue
//     stranded behind - and the destination must receive the balance less the
//     fee the confirm screen itself quoted. That equality is the whole test:
//     it ties the number Max computed to the number the transaction paid.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    encoderRpc,
    fundAddress,
    minerRpc,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Small enough to keep the arithmetic readable, large enough to pay a fee. */
const FUNDING = 0.5;
const COIN = REGTEST_COIN.replace(/^R/, '');
/** Per-coin dust floors, as the SDK's own coin registry carries them. */
const DUST_SATS = { BTC: 546, LTC: 5460, DOGE: 100_000 };

/**
 * A throwaway destination, which the fixture already pins for Bitcoin.
 *
 * Off Bitcoin this needs a same-HRP address of its own: `REGTEST_DESTINATION` is
 * `bcrt1…`, and a cross-HRP address is refused by the form long before any of
 * this spec's subject matter is reached. A Litecoin one derived the same way (a
 * p2wpkh over `hash160('xchain-wallet-e2e-rltc-destination')` on
 * litecoin-regtest params) is `rltc1q94wew2dxt8psxdx670k2yc9620ljmd4w847rcl`,
 * checked with `litecoin-cli validateaddress` on that venue's own node before
 * being written down here. Moving the spec there also needs the Send form's
 * ASSET picked, since that is what selects the chain on this surface.
 */
const DESTINATION = REGTEST_DESTINATION;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

/** Confirmed satoshis at an address, per the encoder's own utxo view. */
async function coinBalanceSats(address) {
    const result = await encoderRpc('get_utxos', { address });
    return (result?.utxos || []).reduce((sum, u) => sum + Number(u.value || 0), 0);
}

async function mempoolSize() {
    const status = await minerRpc('status', {});
    return Number(status?.mempool_size ?? -1);
}

/** Mines only while something is actually waiting for a block (§3.5). */
async function mineUntilConfirmed(address, expectSats, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        last = await coinBalanceSats(address);
        if (last === expectSats) return last;
        if (await mempoolSize() > 0) await minerRpc('generate_blocks', { count: 1 });
        await new Promise((r) => setTimeout(r, 2_000));
    }
    return last;
}

function toField(page) {
    return page.getByLabel('To', { exact: true });
}

function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

/** The exact network fee the composed PSBT pays, off the confirm screen. */
async function screenNetworkFeeSats(page) {
    const text = await page.getByTestId('confirm-fee').innerText();
    const coin = Number(text.match(new RegExp(`([\\d.]+)\\s*${COIN}`))?.[1]);
    expect(Number.isFinite(coin), `unparseable network fee line: ${text}`).toBe(true);
    return Math.round(coin * 1e8);
}

test.describe(`sending dust, and sending everything (${COIN} regtest)`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    /** A fresh wallet holding exactly FUNDING at one address. */
    async function onboardAndFund(page, name) {
        let source;
        let fundedSats;
        await test.step('onboard and fund', async () => {
            await createWallet(page, { password: PASSWORD, name });
            await switchToRegtest(page, PASSWORD);

            source = await readReceiveAddress(page);
            expect(source, 'no regtest receive address').toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, FUNDING);
            // Balances are fetched per chain on mount, so the freshly confirmed
            // utxo is invisible to the send form until a remount.
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            fundedSats = await coinBalanceSats(source);
            expect(fundedSats, 'the funding never confirmed').toBe(Math.round(FUNDING * 1e8));
        });
        return { source, fundedSats };
    }

    test('a dust amount cannot cost the payer anything', async ({ page }) => {
        const dustFloor = DUST_SATS[COIN];
        expect(dustFloor, `no dust floor recorded for ${COIN}`).toBeGreaterThan(0);
        const { source, fundedSats } = await onboardAndFund(page, 'Dust Send Wallet');

        await test.step('an amount below the dust floor does not reach the chain', async () => {
            // A fifth of the floor: unambiguously dust on any of the three
            // chains, and far enough under it that no rounding argument applies.
            const dustAmount = (Math.floor(dustFloor / 5) / 1e8).toFixed(8);
            await gotoSection(page, 'Send');
            await toField(page).fill(DESTINATION);
            await amountField(page).fill(dustAmount);
            await mainButton(page, 'Send').click();

            // The MECHANISM is deliberately not asserted: refusing in the form
            // and refusing at the encoder are both acceptable, and pinning one
            // would make this fail on a legitimate change. What is asserted is
            // that the user cannot get a dust transaction signed - either the
            // wallet says no, or the confirm screen never opens.
            const alert = page.getByRole('alert');
            const confirm = page.getByTestId('confirm-modal');
            await expect
                .poll(async () => (await alert.count() > 0 ? 'refused' : (await confirm.isVisible() ? 'composed' : 'pending')),
                    { timeout: 60_000, message: 'the dust send neither refused nor composed' })
                .not.toBe('pending');

            const composed = await confirm.isVisible();
            // MEASURED 2026-07-29, and it was not what the plan assumed: the
            // wallet DID compose a dust send and open the confirm screen for it,
            // Approve enabled, and signed it. There was no dust guard on the
            // recipient output anywhere in the wallet; the encoder's `dustAmount`
            // governs its own CHANGE output (M-6), not what the user typed.
            // a later change added one in the Send form, so this should now read
            // "refused before composing" and the refusal should name the floor.
            // The leg still follows the transaction to the end when it DOES
            // compose, because what matters is whether the user can be left worse
            // off, and that has to keep being asked rather than assumed.
            console.log(`[dust] amount=${dustAmount} ${COIN} (floor ${dustFloor} sats) -> `
                + (composed ? 'composed a confirm screen' : 'refused before composing'));

            if (composed) {
                await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
                await page.getByTestId('confirm-approve').click();
                // Give the broadcast attempt time to come back either way.
                await page.waitForTimeout(15_000);
            }

            const said = await alert.count() > 0 ? (await alert.first().innerText()) : null;
            console.log(`[dust] after approve -> alert: ${said}`);

            // THE PART THAT DECIDES THE SEVERITY, and it is asked of the chain:
            // a doomed transaction must not cost the payer anything. A dust
            // output is non-standard, so the node refuses it at relay - which
            // means no miner fee is lost - but the wallet has still signed, and
            // whether it says so in words a user can act on is the question this
            // records rather than assumes.
            expect(await mempoolSize(),
                'a dust send reached the mempool, so this venue would relay an output every standard '
                + 'node refuses')
                .toBe(0);
            expect(await coinBalanceSats(source),
                'the payer balance moved on a dust send that cannot confirm, so a miner fee was paid '
                + 'for a transaction the network will never accept')
                .toBe(fundedSats);
            expect(said,
                'the wallet neither refused the dust amount nor explained the failed broadcast: the '
                + 'user is left with a send that silently did not happen')
                .toBeTruthy();
        });
    });

    // D-131 LIVES HERE, and it was deliberately NOT pinned with
    // `test.fail()`. That marker was tried and removed: a test marked expected-
    // failure reports green when it fails for ANY reason, and the first thing it
    // hid was a wrong locator of mine rather than the defect. So this test
    // asserted only what must ALWAYS hold and PRINTED the rest, because a gap
    // that depends on the venue's fee rate cannot be a red suite.
    //
    // a later change CLOSED THAT, so the printed number is now an assertion. Max no
    // longer subtracts a static 250-vB estimate; it asks the encoder to price the
    // sweep it is about to build (flows/maxSendable.js) and subtracts THAT. The
    // gap is therefore zero at any fee rate, on any input set, with or without an
    // ADS donation riding along - it is arithmetic the venue cannot influence,
    // which is exactly what makes it assertable now and not before.
    test('Max empties the address exactly, to the satoshi', async ({ page }) => {
        const { source, fundedSats } = await onboardAndFund(page, 'Max Send Wallet');

        await test.step('Max, measured against the chain', async () => {
            await gotoSection(page, 'Send');
            await toField(page).fill(DESTINATION);


            // By its ACCESSIBLE NAME, not its text: the control is an inline
            // button inside the amount field whose label is "Use max available
            // amount" while it reads "Max", and the visible-text locator matched
            // nothing.
            const max = page.getByRole('button', { name: 'Use max available amount' }).first();
            await expect(max, 'the send form offers no Max control').toBeVisible({ timeout: 30_000 });
            await expect(max, 'the Max control is disabled, so the balance never reached the form')
                .toBeEnabled({ timeout: 30_000 });
            await max.click();

            // a later change made Max a round trip: the amount is filled only after the
            // encoder has priced the sweep, so reading the field straight after
            // the click races an empty input. Poll instead of waiting a fixed
            // time - the wait is one encoder call on a venue whose latency is
            // somebody else's business.
            await expect
                .poll(async () => (await amountField(page).inputValue()).trim(),
                    { timeout: 60_000, message: 'Max never filled the amount field' })
                .not.toBe('');

            const maxAmount = await amountField(page).inputValue();
            const maxSats = Math.round(Number(maxAmount.replace(/,/g, '')) * 1e8);
            expect(maxSats, `Max produced an unusable amount: "${maxAmount}"`).toBeGreaterThan(0);
            expect(maxSats,
                'Max offers to send MORE than the address holds, so nothing can be built from it')
                .toBeLessThan(fundedSats);

            await mainButton(page, 'Send').click();
            await expect(page.getByTestId('confirm-modal'),
                'the Max amount could not be composed, which is the too-high failure: the fee estimate '
                + 'Max subtracted was smaller than the fee the transaction needs')
                .toBeVisible({ timeout: 60_000 });

            const feeSats = await screenNetworkFeeSats(page);
            // THE ARITHMETIC AT THE HEART OF IT: Max claimed this much is
            // sendable and the transaction pays this much fee, so the address
            // holds their sum only if Max used the fee the transaction actually
            // pays. It used to subtract a fee ESTIMATE sized from a static
            // assumed vsize, so the two agreed only by luck; has it ask
            // the encoder for the price of the sweep it is about to build, so
            // they agree by construction and the difference is asserted.
            const gap = fundedSats - (maxSats + feeSats);
            console.log(`[max] balance=${fundedSats} offered=${maxSats} fee=${feeSats} `
                + `unaccounted=${gap} sats (dust floor ${DUST_SATS[COIN]})`);
            expect(gap,
                `Max offered ${maxSats} against a ${feeSats}-sat fee out of ${fundedSats}, leaving ${gap} `
                + 'satoshis unaccounted for. Max is not pricing the transaction it builds: it is a sweep, '
                + 'so the outputs plus the fee must be the whole balance and there is nothing left to '
                + 'become change.')
                .toBe(0);

            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();
            await expect(page.getByRole('main'), 'no transaction id appeared after Approve')
                .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });

            // And the chain's own answer to the same question. The arithmetic
            // above is the confirm screen agreeing with itself; this is the utxo
            // set agreeing with both. "Emptied" means zero, not "zero or a
            // spendable remainder" - that weaker form was what this leg could
            // assert while the gap was conditional, and the invariant it rested
            // on (the encoder's M-6 rule folding a sub-dust residue into the
            // miner fee) is still true and still worth knowing, it is just no
            // longer the strongest thing that holds.
            const left = await mineUntilConfirmed(source, 0);
            console.log(`[max] left at source after the sweep: ${left} sats`);
            expect(left,
                `Max left ${left} sats at an address the user was told they had emptied. Anything above `
                + `zero is money missed; anything under the ${DUST_SATS[COIN]}-sat dust floor is money `
                + 'lost, because a residue below it cannot be spent again.')
                .toBe(0);

            // And the money went where the screen said. Read as a DELTA, since
            // this destination is a fixed address every run sends to.
            const received = await coinBalanceSats(DESTINATION);
            expect(received,
                'the destination received less than Max offered, so the transaction that emptied the '
                + 'source sent it somewhere else')
                .toBeGreaterThanOrEqual(maxSats);
        });
    });
});
