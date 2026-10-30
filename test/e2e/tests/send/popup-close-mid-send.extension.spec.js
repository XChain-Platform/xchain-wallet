// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The popup closes on every focus loss. Closing it, or evicting the worker,
// at the instant of Approve must leave exactly one broadcast on the chain and
// nothing a later Finish could send a second time.

import {
    completeRecoveryPhraseChallenge, dismissIntroCarousel, gotoSection, mainButton, readRecoveryPhrase, unlockedAnyScreen,
} from '../../fixtures/wallet.js';
import { expect, killServiceWorker, test, waitForServiceWorker } from '../../fixtures/extension.js';
import {
    REGTEST_DESTINATION, encoderRpc, expectConfirmModal, fundAddress, minerRpc,
    readReceiveAddress, switchToRegtest, unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'extpassword1234';
const FUNDING_BTC = 0.004;
// An amount no other run sends, so its outputs on the shared destination are countable.
const SEND_BTC = String(process.env.S1_SEND_BTC ?? '0.00123457');
const SEND_SATS = String(Math.round(Number(SEND_BTC) * 1e8));

async function countArrivals() {
    const result = await encoderRpc('get_utxos', { address: REGTEST_DESTINATION });
    return (result?.utxos ?? []).filter((u) => String(u.value) === SEND_SATS).length;
}

// Mines, then waits until the tracker's count holds still for several reads.
async function arrivals() {
    await minerRpc('generate_blocks', { count: 1 }).catch(() => {});
    let last = await countArrivals();
    let stable = 0;
    for (let i = 0; i < 40 && stable < 4; i += 1) {
        await new Promise((r) => setTimeout(r, 2_000));
        const now = await countArrivals();
        stable = now === last ? stable + 1 : 0;
        last = now;
    }
    return last;
}

// createWallet waits for Home's balance region, which an offline popup (this
// venue blocks every host but this machine until the switch to regtest) never
// paints, so the walk ends on any unlocked screen instead.
async function createWalletOffline(page) {
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Create new wallet' }).click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel(/^Confirm( password)?$/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Next' }).click();
    const words = await readRecoveryPhrase(page);
    await page.getByLabel(/written down|saved my recovery phrase/i).check();
    await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
    await completeRecoveryPhraseChallenge(page, words);
    await page.getByRole('button', { name: 'Create wallet' }).click();
    await expect(unlockedAnyScreen(page)).toBeVisible({ timeout: 180_000 });
}

const t0 = Date.now();
const step = (what) => console.log('[s1] +' + Math.round((Date.now() - t0) / 1000) + 's ' + what);

async function fundedWallet(page) {
    await createWalletOffline(page);
    step('wallet created');
    await switchToRegtest(page, PASSWORD);
    step('on regtest');
    const own = await readReceiveAddress(page);
    step('own address read');
    // The shared miner refuses a fund while it is mid-block; a block and a pause clear it.
    for (let attempt = 1; ; attempt += 1) {
        try { await fundAddress(own, FUNDING_BTC); break; } catch (err) {
            if (attempt === 15) throw err;
            await new Promise((r) => setTimeout(r, 20_000));
            await minerRpc('generate_blocks', { count: 1 }).catch(() => {});
        }
    }
    step('funded');
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    step('reloaded');
}

async function openConfirm(page) {
    await gotoSection(page, 'Send');
    await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(SEND_BTC);
    await mainButton(page, 'Send').click();
    await expectConfirmModal(page, 'this action', 30_000);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 60_000 });
}

async function pressApprove(page) {
    const password = page.getByLabel(/password/i);
    if (await password.count() > 0) await password.first().fill(PASSWORD);
    await page.getByTestId('confirm-approve').click({ noWaitAfter: true });
}

async function reopen(context, extensionId) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await unlockAfterReload(page, PASSWORD).catch(() => {});
    return page;
}

async function settleAndFinishIfOffered(reopened, sentBeforeReopen) {
    const card = reopened.getByTestId('resume-confirm-card');
    await reopened.waitForTimeout(3_000);
    const offered = await card.count();
    expect(
        sentBeforeReopen && offered,
        'Home offers to finish a send that has already broadcast',
    ).toBeFalsy();
    const text = async (n) => JSON.stringify((await reopened.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, n));
    if (offered) {
        console.log(`[s1] arrivals on destination before Finish = ${await arrivals()}`);
        await card.first().getByRole('button', { name: /Finish/ }).click();
        await reopened.waitForTimeout(8_000);
        console.log(`[s1] resume screen: ${await text(500)}`);
        await pressApprove(reopened);
        await reopened.waitForTimeout(15_000);
        console.log(`[s1] after approve: ${await text(2500)}`);
    }
    return offered;
}

test.setTimeout(900_000);

test.describe('Approve interrupted by the popup closing or the worker stopping', () => {
    for (const delay of [0, 150, 600]) {
        test(`popup closed ${delay} ms after Approve: one broadcast, no second send`, async ({ context, extensionId, page }) => {
            await fundedWallet(page);
            const before = await arrivals();
            await openConfirm(page);
            await pressApprove(page);
            if (delay) await page.waitForTimeout(delay);
            await page.close();
            await new Promise((r) => setTimeout(r, 20_000));
            const sentBeforeReopen = (await arrivals()) - before === 1;
            const reopened = await reopen(context, extensionId);
            const offered = await settleAndFinishIfOffered(reopened, sentBeforeReopen);
            console.log(`[s1] close@${delay}ms: resume cards offered after reopen = ${offered}`);
            await new Promise((r) => setTimeout(r, 10_000));
            const after = await arrivals();
            console.log(`[s1] close@${delay}ms: arrivals ${before} -> ${after}`);
            expect(after - before, 'sends that reached the destination').toBeLessThanOrEqual(1);
        });
    }

    test('worker stopped right after Approve: one broadcast, no second send', async ({ context, extensionId, page }) => {
        await fundedWallet(page);
        const before = await arrivals();
        await openConfirm(page);
        await pressApprove(page);
        await killServiceWorker(context, page).catch(() => {});
        await waitForServiceWorker(context).catch(() => {});
        await new Promise((r) => setTimeout(r, 20_000));
        const sentBeforeReopen = (await arrivals()) - before === 1;
        const reopened = await reopen(context, extensionId);
        const offered = await settleAndFinishIfOffered(reopened, sentBeforeReopen);
        console.log(`[s1] sw-kill: resume cards offered after reopen = ${offered}`);
        await new Promise((r) => setTimeout(r, 10_000));
        const after = await arrivals();
        console.log(`[s1] sw-kill: arrivals ${before} -> ${after}`);
        expect(after - before).toBeLessThanOrEqual(1);
    });

    test('double-clicking Approve sends once', async ({ page }) => {
        await fundedWallet(page);
        const before = await arrivals();
        await openConfirm(page);
        const password = page.getByLabel(/password/i);
        if (await password.count() > 0) await password.first().fill(PASSWORD);
        await page.getByTestId('confirm-approve').dblclick({ noWaitAfter: true }).catch(() => {});
        await page.waitForTimeout(30_000);
        const after = await arrivals();
        console.log(`[s1] dblclick: arrivals ${before} -> ${after}`);
        expect(after - before).toBe(1);
    });
});
