// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The axe-core leg of §8.6 ("axe-core popup + full"), on the confirm
// surface.
//
// The dev-server a11y suite scans every screen up to the Send FORM and
// stops. The screen every signature now passes through - the one place a
// user is told what they are authorizing - was never scanned.
//
// WHY IT LIVES ON THE REGTEST VENUE. The confirm page only exists after a
// successful compose, and the dev shell cannot compose: its resolver now
// loads the REAL SDK (vite pre-bundles `xchain-sdk` into `.vite/deps`, so
// the dynamic import that documented as failing now succeeds), which
// then points at mainnet explorers the test browser cannot reach, and every
// compose ends in "Couldn't send. The network is unreachable." The regtest
// venue serves a production build against a chain that answers, so the
// surface renders for real - including a genuine pre-flight report, which
// the mock could only ever approximate.
//
// Scanned at BOTH widths on purpose. §5.2.7 makes the pinned header/footer
// and internally-scrolling body a SAFETY property (Reject must stay
// reachable in a ~360x600 popup), and that layout only engages in the
// narrow band, where the responsive shell also swaps the nav rail for a
// bottom tab bar. A desktop-only scan cannot see it.

import { createWallet, expect, gotoSection, mainButton, test } from '../../fixtures/wallet.js';
import { scan } from '../../fixtures/a11y.js';
import {
    expectConfirmModal,
    fundAddress,
    mintXchain,
    readReceiveAddress,
    REGTEST_DESTINATION,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    warmPreflight,
} from '../../fixtures/regtest.js';

const PASSWORD = 'a11yconfirmpassword';
const FUNDING_BTC = 1;
const MINT_XCHAIN = 500;
/** Beyond the minted balance, so the dry-run rejects it (see preflight-gate). */
const UNAFFORDABLE = '999999';
const AFFORDABLE = '25';
/** The MV3 popup band; the config's desktop default is the "full" arm. */
const POPUP = { width: 360, height: 600 };

async function composeTokenSend(page, amount) {
    await gotoSection(page, 'Send');

    // The picker is only opened when the form is not already on XCHAIN. Each
    // test composes twice (once per width) and the form keeps its asset, so
    // re-opening the picker on the second pass both does nothing and races the
    // re-render behind it - the button detaches mid-click.
    const assetButton = page.getByRole('button', { name: /Change asset/ });
    await expect(assetButton).toBeVisible();
    if (!/currently XCHAIN/i.test(await assetButton.getAttribute('aria-label') || '')) {
        await assetButton.click();
        await page.getByLabel('Search coins or tokens').fill('XCHAIN');
        await page.getByLabel(/Open XCHAIN details/i).click();
    }

    await page.getByLabel('To', { exact: true }).fill(REGTEST_DESTINATION);
    await page.getByRole('textbox', { name: /^Amount/ }).fill(amount);
    await mainButton(page, 'Send').click();
    await expectConfirmModal(page, 'this action', 30_000);
}

async function fundedWallet(page) {
    await createWallet(page, { password: PASSWORD });
    await switchToRegtest(page, PASSWORD);
    const own = await readReceiveAddress(page);
    await fundAddress(own, FUNDING_BTC);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    await mintXchain(page, MINT_XCHAIN);
    await waitForTokenBalance(own, 'XCHAIN', MINT_XCHAIN);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return own;
}

/**
 * Warms the dry-run for one of the two amounts this spec composes.
 *
 * The fail arm is the scan that matters here - it is the only state that
 * renders the error list and the "Sign anyway" checkboxes - and it exists
 * only if the Tier-1 verdict arrives inside the SDK's 4000ms budget, which a
 * cold dry-run on this shared venue frequently misses. Without this the scan
 * would quietly fall back to the pass layout and audit the wrong screen.
 * See `warmPreflight`.
 */
async function warmSend(source, amount, expected) {
    const quote = await warmPreflight({
        action: 'SEND',
        params: `0|XCHAIN|${amount}|${REGTEST_DESTINATION}`,
        source,
    });
    expect(quote.valid, `the venue's own dry-run for a ${amount} XCHAIN send disagrees `
        + `with this spec's premise: ${JSON.stringify(quote)}`).toBe(expected);
}

/**
 * Scans the confirm surface in both of its §4.2 verdict states.
 *
 * One test per width rather than one per state: the expensive part is
 * funding and minting, and both states are reachable from the same wallet
 * by changing one field.
 */
async function scanBothVerdicts(page, own, width) {
    await warmSend(own, AFFORDABLE, true);
    await composeTokenSend(page, AFFORDABLE);
    await expect(page.getByTestId('preflight-chip')).toHaveText('Looks good');
    await scan(page, `Confirm surface (ready, ${width})`);
    await page.getByTestId('confirm-reject').click();

    await warmSend(own, UNAFFORDABLE, false);

    // The fail state is its own scan target, not a variation: it is the only
    // one that renders the error list, the per-finding "Sign anyway"
    // checkboxes and `aria-live="assertive"`, and it is the state a user is
    // most likely to be reading carefully. An unlabelled override control
    // here is a consent problem, not a lint finding.
    await composeTokenSend(page, UNAFFORDABLE);
    await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
    await expect(page.getByTestId('ack-DRYRUN_INVALID')).toBeVisible();
    await scan(page, `Confirm surface (pre-flight fail, ${width})`);
}

test.describe('a11y: confirm surface, full width (§5.2)', () => {
    test('both verdict states scan clean', async ({ page }) => {
        const own = await fundedWallet(page);
        await scanBothVerdicts(page, own, 'full');
    });
});

// The narrow band is a separate CONTEXT, not a mid-test resize. The
// responsive shell mounts different components below 900px and again below
// 600px (the nav rail gives way to <BottomTabBar>), so resizing an already-
// mounted page detaches the very controls a walk is holding - which is
// exactly how the first version of this spec failed. Setting the viewport
// before anything mounts is also the honest arm: it is the layout the MV3
// popup actually starts in.
test.describe('a11y: confirm surface, popup width (§5.2)', () => {
    test.use({ viewport: POPUP });

    test('both verdict states scan clean', async ({ page }) => {
        const own = await fundedWallet(page);
        await scanBothVerdicts(page, own, 'popup');
    });
});
