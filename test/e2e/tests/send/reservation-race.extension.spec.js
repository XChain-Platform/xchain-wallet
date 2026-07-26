// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §8.6 scenario 2: the two-window same-balance race (§4.7).
//
// `approvalBroker` intentionally allows N concurrent approval windows, so
// two of them can be looking at the same balance at the same time. Without
// a shared ledger each window pre-flights against the full balance, both
// say "you can afford this", and the user authorises two payments the
// balance can only cover once. The second broadcast is then rejected by
// the chain after it was signed.
//
// The reservation ledger closes that window by registering an approved
// but not-yet-broadcast amount and netting it into the NEXT window's
// pre-flight as a local delta. `dfc6a20` made it HOST-shared for exactly
// this reason.
//
// This can only be tested in the extension. The web shell builds one host
// per PAGE, so two tabs get two independent ledgers and no protection at
// all - a fact worth stating in the threat model rather than leaving
// implied by a passing extension test.
//
// WHY A TOKEN SEND, NOT A NATIVE ONE . The reservation ledger nets
// a reservation into the NEXT window's PRE-FLIGHT, and it reserves the TOKEN
// tick only: `reserveFromSimulation` excludes the native coin on purpose
// (its debit is dominated by the miner fee), and a native-coin send is a
// `bareNativePayment` that skips pre-flight entirely (useConfirmAction.js).
// So a native send neither registers nor nets a reservation - it is
// deliberately outside §4.7. To exercise the protection the wallet actually
// implements, both windows send an XChain TOKEN (XCHAIN, free-mintable on
// regtest), which has a pre-flight and a reservable delta.

import {
    createWallet, gotoSection, mainButton,
} from '../../fixtures/wallet.js';
import { expect, openSecondPopup, test } from '../../fixtures/extension.js';
import {
    EXPLORER_URL, REGTEST_COIN, REGTEST_DESTINATION,
    fundAddress, minerRpc, readReceiveAddress, switchToRegtest, unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'extpassword1234';
const FUNDING_BTC = 1;
// Mint this much XCHAIN, then send more than half of it in each window: the
// two sends cannot both succeed, so the second is only affordable if the
// first reservation is ignored.
const MINT_XCHAIN = 1000;
const SEND_XCHAIN = '600';

// Mint XCHAIN to the active address by driving the command palette ->
// Advanced action -> MINT (the friendly Mint form is balance-scoped and
// won't list a tick you hold zero of). XCHAIN is free-mintable on regtest.
async function mintXchain(page, amount) {
    await page.keyboard.press('ControlOrMeta+k');
    const combobox = page.getByRole('combobox');
    await expect(combobox).toBeVisible();
    await combobox.fill('Advanced action');
    await page.keyboard.press('Enter');

    await page.getByLabel('Action').selectOption('MINT');
    await page.getByRole('textbox', { name: 'TICK', exact: true }).fill('XCHAIN');
    await page.getByRole('textbox', { name: 'AMOUNT', exact: true }).fill(String(amount));
    await page.getByRole('button', { name: 'Sign action' }).click();

    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await page.getByTestId('confirm-approve').click();
    // The advanced-action confirm shows a different terminal state than the
    // Send flow; the on-chain balance is the truth we wait on below.
    await page.waitForTimeout(4_000);
}

async function waitForTokenBalance(address, tick, min, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${EXPLORER_URL}/${REGTEST_COIN}/api/balances/${address}`);
            const body = await res.json();
            const row = (body?.data || []).find((b) => b.tick === tick);
            last = row ? row.amount : null;
            if (row && Number(row.amount) >= min) return row;
        } catch { /* transient */ }
        await minerRpc('generate_blocks', { count: 1 });
        await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`${tick} balance never reached ${min} for ${address} (last=${last})`);
}

// Compose an XCHAIN send: pick the token in the Send asset picker, then fill
// the destination + amount and open the confirm modal.
async function composeTokenSend(page) {
    await gotoSection(page, 'Send');
    await page.getByRole('button', { name: /Change asset/ }).click();
    await page.getByLabel('Search coins or tokens').fill('XCHAIN');
    await page.getByLabel(/Open XCHAIN details/i).click();
    await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(SEND_XCHAIN);
    await mainButton(page, 'Send').click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
}

test.describe('two-window same-balance race (extension)', () => {

    test('one service worker serves every popup, so the ledger can be shared', async ({ context, extensionId, page }) => {
        // The structural precondition for the whole scenario. If this ever
        // stops holding, the race test below would still pass while
        // protecting nothing, so assert it separately and first.
        const second = await openSecondPopup(context, extensionId);
        await expect(second).toHaveTitle(/XChain/i);
        expect(context.serviceWorkers().length,
            'more than one service worker means the popups no longer share a host').toBe(1);
        await second.close();
        expect(page.url()).toContain(extensionId);
    });

    // Native sends are deliberately outside §4.7 , so this uses a TOKEN
    // send (XCHAIN, free-mintable on regtest). Getting here fixed two §4.7 bugs:
    //   : the pre-flight coalescer keyed on (chainId, actionString, source)
    //     and omitted localDeltas, so a reservation-carrying pre-flight coalesced
    //     onto the un-netted producer (fixed in xchain-sdk with a unit test).
    //   : the reservation is released the instant window 1's send is signed
    //     and handed off, and nothing covered the broadcast -> confirmation gap.
    //     Fixed by netting the source's UNCONFIRMED pendingTx debits (submitAction
    //     now records the SEND's tick/amount; the host pre-flight nets them), so
    //     window 1's broadcast-but-unconfirmed 600 XCHAIN reduces window 2's
    //     available balance even after the reservation released.
    test('the second window sees the first window reservation and warns', async ({ context, extensionId, page }) => {
        await createWallet(page, { password: PASSWORD, navigate: false });
        await switchToRegtest(page, PASSWORD);

        const own = await readReceiveAddress(page);
        // BTC funds the miner fee; the reservable balance is the minted token.
        await fundAddress(own, FUNDING_BTC);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        await mintXchain(page, MINT_XCHAIN);
        await minerRpc('generate_blocks', { count: 2 });
        await waitForTokenBalance(own, 'XCHAIN', MINT_XCHAIN);

        // The mint left the popup on the advanced-action terminal screen;
        // reload back to a clean unlocked Home before composing the send.
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        // Window 1: compose and APPROVE, which registers the reservation.
        await composeTokenSend(page);
        await page.getByTestId('confirm-approve').click();
        await expect(page.getByRole('heading', { name: /Broadcast pending|Signed\./ }))
            .toBeVisible({ timeout: 120_000 });
        // Let window 1's broadcast settle into a durable pendingTx (status
        // signed/broadcast) before window 2 pre-flights; the netting reads the
        // shared pendingTx store, so this closes the write-vs-read race that
        // otherwise makes the assertion timing-dependent.
        await page.waitForTimeout(3_000);

        // Window 2: the same token balance, reserved by window 1. The shared
        // §4.7 ledger must net window 1's reservation into this pre-flight.
        const second = await openSecondPopup(context, extensionId);
        await unlockAfterReload(second, PASSWORD);
        await composeTokenSend(second);

        // The protection may present as a pre-flight warning, a fail
        // verdict, or a blocked Approve; what must NOT happen is a clean
        // "Looks good" on a payment the balance can no longer cover.
        const chip = second.getByTestId('preflight-chip');
        await expect(chip).toBeVisible();
        await expect(chip, 'second window must not report a clean pass on an already-spent balance')
            .not.toHaveText(/Looks good/i);
    });
});
