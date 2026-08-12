// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Finishing a confirm the popup closed on.
//
// This is the venue the item's own handover insisted on: "that popup-close
// path cannot be trusted from unit tests. Drive a packaged extension before
// believing it works." Two prior findings in this spec's history earned that
// sentence - §5.4's stated premise (that a WORKER eviction loses the confirm)
// was overturned the first time anyone measured it, and that worker bug was
// invisible to every Node smoke because they read the bundle as text instead of
// executing it.
//
// The hazard is the POPUP CLOSING, which MV3 popups do on every focus loss,
// including the focus loss a hardware prompt causes. What dies with it is an
// UNSIGNED composed PSBT - nothing money-critical, which is why §5.4 re-priced
// this as a UX nicety - and what this spec proves is that it no longer dies.
//
// The assertions that matter are the two that are NOT about convenience:
//
//   - the resumed approve signs the PSBT that was stored, and lands a real
//     transaction on a real chain;
//   - the session is GONE afterwards. A session outliving its confirm is an
//     invitation to re-approve an already-broadcast transaction, which is the
//     §5.3.4 double-broadcast trap, and it is the reason `clear` is a safety
//     requirement rather than tidy-up.

import { createWallet, gotoSection, mainButton } from '../../fixtures/wallet.js';
import { expect, test } from '../../fixtures/extension.js';
import {
    REGTEST_DESTINATION, fundAddress, readReceiveAddress, switchToRegtest, unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'extpassword1234';
const FUNDING_BTC = 1;
const SEND_BTC = '0.1';

/** Drive a fresh popup to a funded, unlocked Home on regtest. */
async function fundedWallet(page) {
    await createWallet(page, { password: PASSWORD, navigate: false });
    await switchToRegtest(page, PASSWORD);
    const own = await readReceiveAddress(page);
    await fundAddress(own, FUNDING_BTC);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return own;
}

/** Fill Send and press it, stopping on the open confirm page. */
async function openConfirm(page) {
    await gotoSection(page, 'Send');
    await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(SEND_BTC);
    await mainButton(page, 'Send').click();
    await expect(page.getByTestId('confirm-modal')).toBeVisible();
    await expect(page.getByTestId('confirm-approve')).toBeEnabled();
}

test.describe('Resuming a confirm the popup closed on (extension)', () => {

    test('a closed popup leaves the confirm resumable, and finishing it broadcasts', async ({ context, extensionId, page }) => {
        await fundedWallet(page);
        await openConfirm(page);

        // The hazard itself. Not a worker kill (measured survivable) and not a
        // reload: the popup WINDOW going away, which is what a focus loss does.
        await page.close();

        const reopened = await context.newPage();
        await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
        await unlockAfterReload(reopened, PASSWORD).catch(() => { /* session may still be unlocked */ });

        // Home offers it back. The card says "not sent yet" out loud because an
        // offer to "resume" is otherwise ambiguous about whether money moved.
        const card = reopened.getByTestId('resume-confirm-card');
        await expect(
            card.first(),
            'after the popup closed on an open confirm, Home offered no way to finish it',
        ).toBeVisible({ timeout: 30_000 });
        await expect(card.first()).toContainText(/Not sent yet/i);

        await card.first().getByRole('button', { name: /Finish/ }).click();

        // The resume screen runs the §4.6 liveness gate and a fresh pre-flight
        // before Approve enables. It must reach an approvable state: a stored
        // confirm that can never be approved is the same lost transaction with
        // extra steps.
        const approve = reopened.getByTestId('confirm-approve');
        await expect(approve).toBeEnabled({ timeout: 60_000 });

        const password = reopened.getByLabel(/password/i);
        if (await password.count() > 0) await password.first().fill(PASSWORD);
        await approve.click();

        // The terminal state must be VISIBLE, not merely reached. The first run
        // of this spec failed here against a send that had actually broadcast,
        // because the screen handed control back to the shell the instant the
        // broadcast returned and Home replaced the result - so the user was
        // told nothing about a transaction they had just authorized.
        const sent = reopened.getByTestId('resume-confirm-sent');
        await expect(
            sent,
            'the resumed approve never reached a terminal state the user can see',
        ).toBeVisible({ timeout: 120_000 });
        // A txid, not just a success screen: the point of the feature is that
        // the STORED PSBT signs and broadcasts, and only a real txid
        // distinguishes that from a screen that says nice things.
        await expect(sent, 'the resumed send reported no broadcast txid')
            .toContainText(/Transaction [0-9a-f]{64}/);

        await reopened.getByRole('button', { name: 'Back' }).click();

        // And the session is gone. This is the assertion that is about safety
        // rather than convenience: a surviving session would invite a second
        // approve of a transaction that has already broadcast.
        await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
        await expect(reopened.getByTestId('resume-confirm-card')).toHaveCount(0);
    });

    test('discarding an unfinished confirm removes it for good', async ({ context, extensionId, page }) => {
        await fundedWallet(page);
        await openConfirm(page);
        await page.close();

        const reopened = await context.newPage();
        await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
        await unlockAfterReload(reopened, PASSWORD).catch(() => { /* may still be unlocked */ });

        const card = reopened.getByTestId('resume-confirm-card');
        await expect(card.first()).toBeVisible({ timeout: 30_000 });
        await card.first().getByRole('button', { name: /Discard/ }).click();

        await expect(card).toHaveCount(0);

        // Discard has to reach the STORE, not just the view: a card that comes
        // back on the next open is a discard the user cannot trust.
        await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
        await expect(reopened.getByTestId('resume-confirm-card')).toHaveCount(0);
    });
});
