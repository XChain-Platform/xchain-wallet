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

import {
    createWallet, gotoSection, mainButton,
} from '../../fixtures/wallet.js';
import { expect, openSecondPopup, test } from '../../fixtures/extension.js';
import {
    REGTEST_DESTINATION, fundAddress, readReceiveAddress, switchToRegtest, unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'extpassword1234';
const FUNDING_BTC = 1;
// Deliberately more than half the funded balance, so the two sends cannot
// both succeed: the second is only affordable if the first is ignored.
const SEND_BTC = '0.6';

function toField(page) {
    return page.getByLabel('To', { exact: true });
}

function amountField(page) {
    return page.getByRole('textbox', { name: /^Amount/ });
}

async function composeSend(page) {
    await gotoSection(page, 'Send');
    await toField(page).fill(REGTEST_DESTINATION);
    await amountField(page).fill(SEND_BTC);
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

    // BLOCKED on , not written blind: the venue below is proven (the
    // structural test above passes, the extension loads, one SW serves every
    // popup), but onboarding cannot COMPLETE in an automated fresh profile.
    // The popup reports "[xchain-wallet/extension] xchain-sdk is not loaded
    // yet (or failed to load); refusing to serve data" and wallet creation
    // bounces back to the recovery-phrase screen. That guard is the 
    // fail-closed protection doing its job; what it is protecting against
    // here is unresolved. Marked fixme rather than deleted so the walk is
    // ready the moment the SW loads its SDK in this venue.
    test.fixme('the second window sees the first window reservation and warns', async ({ context, extensionId, page }) => {
        await createWallet(page, { password: PASSWORD, navigate: false });
        await switchToRegtest(page, PASSWORD);

        const own = await readReceiveAddress(page);
        await fundAddress(own, FUNDING_BTC);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        // Window 1: compose and APPROVE, which is what registers the
        // reservation. Approving is the point: a merely-open modal reserves
        // nothing, because the user has not committed to anything yet.
        await composeSend(page);
        await page.getByTestId('confirm-approve').click();
        await expect(page.getByRole('heading', { name: /Broadcast pending|Signed\./ }))
            .toBeVisible({ timeout: 120_000 });

        // Window 2: the same balance, already spent by window 1. The chain
        // has not confirmed anything yet, so a wallet that reads only the
        // confirmed balance would happily let this through.
        const second = await openSecondPopup(context, extensionId);
        await unlockAfterReload(second, PASSWORD);
        await composeSend(second);

        // The protection may present as a pre-flight warning, a fail
        // verdict, or a blocked Approve; what must NOT happen is a clean
        // "Looks good" on a payment the balance can no longer cover.
        const chip = second.getByTestId('preflight-chip');
        await expect(chip).toBeVisible();
        await expect(chip, 'second window must not report a clean pass on an already-spent balance')
            .not.toHaveText(/Looks good/i);
    });
});
