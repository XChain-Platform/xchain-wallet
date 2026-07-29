// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign §10.3's last unhappy path: a bet from a watcher-mode wallet.
//
// WHY IT IS A SPEC RATHER THAN A NOTE. Session 24 proved this by hand - a DOM
// sweep returned zero Resolve / Cancel / place-bet elements in watcher mode -
// and then D-108 showed the harder half: the hiding was completely SILENT, so
// an operator could not tell "your wallet cannot do this" from "this screen is
// broken". Both halves rot the same way, silently, under any later layout
// change, and neither can be seen without driving the wallet in both modes.
//
// THE CONTROLLED PAIR IS THE POINT. Every assertion below is made twice on the
// SAME market with only the wallet mode changed, so what is proven is
// attributable to watcher mode and not to the market's state, the address, or
// the venue. A one-sided run ("the button is not there") cannot tell hiding
// apart from a market that never offered the button in the first place - and on
// this surface that confusion is easy to fall into, because the oracle of a
// market is never offered a bet on it either (which is what cost the
// unhappy-stakes spec its first run).
//
// TWO ROLES, ONE WALLET, and no funding for the second address: the bettor's
// view is being tested, not its ability to pay, and the spec never submits.
// Address A opens the market; address B is what looks at it.
//
// Runs on Litecoin (XC_REGTEST_COIN=RLTC) for the reasons §3.5 records.

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_COIN,
    fundAddress,
    minerRpc,
    mintXchain,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const MINT_XCHAIN = 100;
/** Long enough that nothing here races the deadline. */
const DEADLINE_LEAD_SEC = 3_600;

// Deliberately does NOT contain the words this spec asserts on: the first run
// failed on its own label, because a market called "Watcher mode ..." makes
// `getByText(/watcher mode/i)` match the market heading as well as the refusal
// (a strict-mode violation that reads exactly like the refusal being absent).
const RUN_TAG = `modegate-${Date.now()}`;

async function explorerJson(path) {
    const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/${path}`, {
        signal: AbortSignal.timeout(15_000),
    });
    return res.json();
}

async function chainTime() {
    const status = await explorerJson('status');
    const tip = Number(status?.chain_tip?.[REGTEST_COIN]);
    if (!Number.isFinite(tip)) throw new Error(`explorer reports no ${REGTEST_COIN} tip`);
    for (let h = tip; h > tip - 10 && h > 0; h--) {
        const block = await explorerJson(`block/${h}`);
        const ts = Number(block?.timestamp);
        if (Number.isFinite(ts) && ts > 0) return ts;
    }
    throw new Error(`no parsed block with a timestamp within 10 blocks of tip ${tip}`);
}

/**
 * The deadline to put in the form, on a venue whose chain clock may be frozen.
 *
 * MEASURED, because the two halves disagree and it costs a run to find out:
 * the pre-flight QUOTE validates a deadline against WALL CLOCK, while the chain
 * judges it against BLOCK TIME. On this stack Litecoin's clock was found nine
 * hours behind wall time (a concurrent session's `setmocktime`, left alone
 * deliberately - moving a shared node's clock is a side effect everyone
 * inherits), and a deadline derived from chain time alone came back
 * `invalid: DEADLINE (past)` from `/feequote` while being perfectly valid on
 * chain. Taking the LATER of the two clocks satisfies both, on a frozen chain
 * and on one that tracks wall time.
 */
async function deadlineUnix(leadSec) {
    const chain = await chainTime();
    return Math.max(chain, Math.floor(Date.now() / 1000)) + leadSec;
}

function toLocalDateTimeInput(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function nudgeChain() {
    try {
        const status = await explorerJson('status');
        if (Number(status?.decoder_lag_blocks?.[REGTEST_COIN] ?? 0) > 3) return;
        await minerRpc('generate_blocks', { count: 1 });
    } catch { /* transient */ }
}

async function waitForToken(address, min, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const body = await explorerJson(`balances/${address}`);
            const row = (body?.data || []).find((b) => b.tick === 'XCHAIN');
            last = row ? Number(row.amount) : 0;
            if (last >= min) return last;
        } catch { /* transient */ }
        await nudgeChain();
        await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`XCHAIN balance never reached ${min} for ${address} (last=${last})`);
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

async function gotoBettingHub(page) {
    await gotoPalette(page, 'Betting');
    await expect(page.getByRole('button', { name: 'Create market', exact: true }))
        .toBeVisible({ timeout: 30_000 });
    await selectVenueChain(page.getByRole('main'));
}

async function fillPasswordIfPresent(scope) {
    const field = scope.getByLabel('Password', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(PASSWORD);
}

async function useAddress(page, address) {
    await gotoPalette(page, 'Addresses');
    await page.getByRole('button', { name: `View address ${address}` }).click();
    await page.getByRole('group', { name: 'Address actions' })
        .getByRole('button', { name: 'Use' }).click();
}

async function signingAddress(page) {
    await gotoBettingHub(page);
    await page.getByRole('button', { name: 'Create market', exact: true }).click();
    const main = page.getByRole('main');
    await selectVenueChain(main);
    return main.getByLabel('Your oracle address').inputValue();
}

/** Generates one address on the venue chain, identified by difference (§3.5). */
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

/**
 * Puts the wallet into `mode` and waits for the write to land.
 *
 * The radio is fully controlled by PERSISTED settings, so it does not flip
 * until the vault write resolves - the same reason `switchToRegtest` clicks the
 * developer-mode switch rather than calling `check()`.
 */
async function setWalletMode(page, mode) {
    const label = mode === 'watcher' ? /^Watcher/ : /^Full/;
    await gotoPalette(page, 'Settings');
    await page.getByRole('button', { name: /^Wallet Mode/ }).click();
    const radio = page.getByRole('radio', { name: label });
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.click();
    await expect(radio, `the wallet did not switch to ${mode} mode`).toBeChecked({ timeout: 30_000 });
}

async function openMarket(page, feedIndex) {
    await gotoBettingHub(page);
    const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^#${feedIndex}\\s`) });
    await expect(row, `market #${feedIndex} is not in the browse list`).toBeVisible({ timeout: 30_000 });
    await row.click();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: new RegExp(RUN_TAG) }).or(main.getByText(RUN_TAG)).first(),
        'the market detail page did not open').toBeVisible({ timeout: 30_000 });
    return main;
}

test.describe('BET in watcher mode', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('a watcher is refused in words, on both sides of the role boundary', async ({ page }) => {
        let oracle;
        let watcher;
        let feedIndex;

        await test.step('onboard, fund, and hold XCHAIN', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Watcher Wallet' });
            await switchToRegtest(page, PASSWORD);

            oracle = await signingAddress(page);
            expect(oracle, `this wallet has no ${REGTEST_COIN} address`).toMatch(REGTEST_ADDRESS_RE);

            await fundAddress(oracle, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            await mintXchain(page, MINT_XCHAIN);
            await waitForToken(oracle, MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
        });

        await test.step('open a market as the oracle', async () => {
            await gotoBettingHub(page);
            await page.getByRole('button', { name: 'Create market', exact: true }).click();
            const main = page.getByRole('main');
            await selectVenueChain(main);

            const tokenField = main.getByRole('button', { name: /^Token bets are placed in:/ });
            await expect(tokenField).toBeVisible({ timeout: 30_000 });
            await tokenField.click();
            await page.locator('[data-balance-key$=":XCHAIN"]').first().click();

            await main.getByLabel('What is being bet on').fill(`Mode gate ${RUN_TAG}`);
            await main.getByLabel('Outcome 0').fill('Yes');
            await main.getByLabel('Outcome 1').fill('No');
            await main.getByLabel('Betting closes')
                .fill(toLocalDateTimeInput(await deadlineUnix(DEADLINE_LEAD_SEC)));
            await fillPasswordIfPresent(main);
            await main.getByRole('button', { name: 'Review market', exact: true }).click();
            await expect(page.getByTestId('confirm-modal')).toBeVisible({ timeout: 60_000 });
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
            await page.getByTestId('confirm-approve').click();

            const until = Date.now() + 180_000;
            let feed = null;
            while (Date.now() < until && !feed) {
                const list = await explorerJson(`bet_feeds/${oracle}/source`);
                feed = (list?.data || []).find((f) => String(f.label).includes(RUN_TAG)) || null;
                if (!feed) { await nudgeChain(); await new Promise((r) => setTimeout(r, 2_000)); }
            }
            expect(feed, `no market labelled ${RUN_TAG} landed for ${oracle}`).toBeTruthy();
            expect(feed.feed_status).toBe('open');
            feedIndex = String(feed.action_index);
        });

        await test.step('a second address, which is NOT the oracle, can bet on it', async () => {
            // No funding on purpose: what is under test is what the screen
            // offers, not whether the stake could be paid. The spec never
            // submits, so a funded address would only cost chain time.
            watcher = await generateVenueAddress(page);
            expect(watcher, 'the generated address is the oracle again').not.toBe(oracle);
            await useAddress(page, watcher);

            const main = await openMarket(page, feedIndex);
            await expect(main.getByRole('heading', { name: 'Place a bet' }),
                'the control half failed: a non-oracle address is not offered a bet in FULL mode, so '
                + 'the watcher assertions below would prove nothing')
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('watcher mode hides the bet, and says why', async () => {
            await setWalletMode(page, 'watcher');

            const main = await openMarket(page, feedIndex);
            await expect(main.getByRole('heading', { name: 'Place a bet' }),
                'a watcher-mode wallet is still offered a stake it cannot sign')
                .toBeHidden({ timeout: 30_000 });

            // D-108: hiding without explaining is the defect. An operator who
            // cannot tell "restricted" from "broken" waits, and on a market
            // with a deadline, waiting is the expensive answer.
            await expect(main.getByText(/watcher mode, so it cannot place a bet/i),
                'the place-bet block vanished with no explanation (D-108 regressed)')
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('and the oracle side is hidden and explained too', async () => {
            await gotoPalette(page, 'My markets');
            const main = page.getByRole('main');
            await expect(main.getByRole('button', { name: new RegExp(`^#${feedIndex}\\b`) })
                .or(main.getByText(new RegExp(RUN_TAG))).first(),
                'the oracle console did not list the market this run created')
                .toBeVisible({ timeout: 30_000 });

            // Resolve is not legal yet (the deadline has not passed), so Cancel
            // is the button that must be absent BECAUSE of watcher mode - and
            // the console has to say so rather than simply showing nothing.
            await expect(main.getByRole('button', { name: /^Cancel and refund/ }),
                'the oracle console still offers Cancel to a wallet that cannot sign')
                .toBeHidden({ timeout: 30_000 });
            await expect(main.getByText(/watcher mode, so it cannot resolve or cancel/i),
                'the oracle console hides its actions silently (D-108 regressed)')
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('back to full mode, and the bet is offered again', async () => {
            // Closes the pair: the difference is watcher mode, not the market.
            await setWalletMode(page, 'full');
            const main = await openMarket(page, feedIndex);
            await expect(main.getByRole('heading', { name: 'Place a bet' }),
                'leaving watcher mode did not restore the place-bet form')
                .toBeVisible({ timeout: 30_000 });
        });
    });
});
