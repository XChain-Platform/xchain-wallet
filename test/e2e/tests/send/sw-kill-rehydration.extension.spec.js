// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §8.6 scenario 5: SW-kill rehydration (§5.4).
//
// Chrome may evict the MV3 service worker after ~30s of perceived idle,
// which is SHORTER than reading a warning list, typing a password, and
// waking a hardware device. The confirm modal is therefore routinely open
// across an eviction, and it holds the one thing that cannot be rebuilt: a
// composed PSBT the user has already been shown. Re-composing after a kill
// would select different UTXOs and break §5.3's byte-identity guarantee, so
// §5.4 persists `{request, composed, report}` in `chrome.storage.session`
// and rehydrates from it.
//
// WHAT THIS ASSERTS, AND WHY IT IS A DISJUNCTION
//
// §5.4's requirement is "rehydration OR a clean explicit failure; a silent
// hang is a test failure". Both outcomes are defensible products - losing
// the request and saying so is honest, and the user simply re-composes -
// but a modal that still looks alive while its host has forgotten the
// request is not: the user types a password into a form that will never do
// anything, on a screen that gives no reason to distrust it. So the
// assertion is deliberately the disjunction, not one arm of it.
//
// Only testable in the extension: there is no service worker to kill in a
// web page (see fixtures/extension.js).

import { createWallet, gotoSection, mainButton } from '../../fixtures/wallet.js';
import {
    expect, killServiceWorker, test, waitForServiceWorker,
} from '../../fixtures/extension.js';
import {
    REGTEST_DESTINATION, fundAddress, readReceiveAddress, switchToRegtest, unlockAfterReload,
} from '../../fixtures/regtest.js';

const PASSWORD = 'extpassword1234';
const FUNDING_BTC = 1;
const SEND_BTC = '0.1';

test.describe('MV3 service-worker kill during confirm (extension)', () => {

    // Venue-gated on (the regtest DB is refusing every per-service
    // user), not on anything in the wallet: the path up to funding is verified
    // in a real packaged extension. Enabled rather than fixme'd because the
    // extension config's global setup fails loudly on an unreachable venue.
    //
    // Expect this to report on when it first runs: §5.4's confirm-side
    // session persistence is implemented and unit-tested but has no production
    // caller, so the rehydrate arm of the assertion below is not wired yet.
    test('a kill mid-modal either rehydrates or fails loudly, never hangs', async ({ context, page }) => {
        await createWallet(page, { password: PASSWORD, navigate: false });
        await switchToRegtest(page, PASSWORD);

        const own = await readReceiveAddress(page);
        await fundAddress(own, FUNDING_BTC);
        await page.reload();
        await unlockAfterReload(page, PASSWORD);

        await gotoSection(page, 'Send');
        await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
        await page.getByRole('textbox', { name: /^Amount/ }).fill(SEND_BTC);
        await mainButton(page, 'Send').click();

        const confirm = page.getByTestId('confirm-modal');
        await expect(confirm).toBeVisible();
        // Compose has completed by the time the modal is open (§5.1: compose
        // runs PRE-open), so the PSBT the kill has to survive exists now.
        await expect(page.getByTestId('confirm-approve')).toBeEnabled();

        // The eviction Chrome performs on idle - NOT chrome.runtime.reload(),
        // which tears down the popup too and would be a restart rather than
        // the worker vanishing under a still-open window.
        await killServiceWorker(context, page);
        await waitForServiceWorker(context);

        // The user does what a user does: the screen still shows a confirm
        // modal, so they approve it.
        const approve = page.getByTestId('confirm-approve');
        const stillPresent = await approve.count() > 0;

        if (stillPresent && await approve.isEnabled()) {
            await approve.click();
        }

        // Whatever the wallet chose to do, it must SAY so within a bounded
        // time. Terminal success, an explicit error, or a modal that closed
        // itself back to a usable form all qualify; a modal frozen in
        // `signing` with no message does not.
        const settled = page.getByRole('heading', { name: /Broadcast pending|Signed\./ })
            .or(page.getByRole('alert'))
            .or(page.getByRole('main').getByRole('button', { name: 'Send', exact: true }));

        await expect(
            settled.first(),
            'after a service-worker kill the confirm modal neither completed, reported an error, '
            + 'nor returned to the form - it hung silently, which §5.4 forbids',
        ).toBeVisible({ timeout: 60_000 });
    });
});
