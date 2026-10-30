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

import {
    createWallet,
    expect,
    openPaletteCommand,
    test,
} from '../../fixtures/wallet.js';
import { scan } from '../../fixtures/a11y.js';
import {
    expectConfirmModal,
    fundAddress,
    readReceiveAddress,
    switchToRegtest,
    unlockAfterReload,
    warmPreflight,
} from '../../fixtures/regtest.js';

const PASSWORD = 'a11yconfirmpassword';
const FUNDING_BTC = 1;
const EXPECTED_XCHAIN_BALANCE = 0;
const ISSUE_SUPPLY = '100';
const ISSUE_TICK = `A11YF${Date.now().toString().slice(-6)}`;
const ISSUE_PARAMS = `0|${ISSUE_TICK}|${ISSUE_SUPPLY}||0||${ISSUE_SUPPLY}`;
/** The MV3 popup band; the config's desktop default is the "full" arm. */
const POPUP = { width: 360, height: 600 };

function feeToggle(scope) {
    const name = /^Pay protocol fee in BTC instead of XCHAIN/;
    return scope.getByRole('switch', { name }).or(scope.getByRole('checkbox', { name })).first();
}

/** Composes the fee-bearing action in the requested protocol-fee lane. */
async function composeIssue(page, { nativeFee }) {
    await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await main.getByLabel('Ticker').fill(ISSUE_TICK);
    await main.getByLabel('Supply', { exact: true }).fill(ISSUE_SUPPLY);
    const toggle = feeToggle(main);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if (nativeFee !== (await toggle.isChecked())) await toggle.click();
    await expect(toggle).toBeChecked({ checked: nativeFee });
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
    await expectConfirmModal(page, `the ISSUE of ${ISSUE_TICK}`, 30_000);
}

async function nativeFundedWallet(page) {
    await createWallet(page, { password: PASSWORD });
    await switchToRegtest(page, PASSWORD);
    const own = await readReceiveAddress(page);
    await fundAddress(own, FUNDING_BTC);
    await page.reload();
    await unlockAfterReload(page, PASSWORD);
    return own;
}

/**
 * Warms the dry-run for one of the two protocol-fee lanes this spec composes.
 *
 * The fail arm is the scan that matters here - it is the only state that
 * renders the error list and the "Sign anyway" checkboxes - and it exists
 * only if the Tier-1 verdict arrives inside the SDK's 4000ms budget, which a
 * cold dry-run on this shared venue frequently misses. Without this the scan
 * would quietly fall back to the pass layout and audit the wrong screen.
 * See `warmPreflight`.
 */
async function warmIssue(source, expected, feeMode = 'xchain') {
    const quote = await warmPreflight({
        action: 'ISSUE',
        params: ISSUE_PARAMS,
        source,
        ...(feeMode === 'native' ? { feeMode } : {}),
    });
    if (feeMode === 'xchain') {
        test.skip(Number(quote.xchainFee) === 0,
            'this venue charges no XCHAIN fee for ISSUE, so the fee shortfall cannot be driven: '
            + JSON.stringify(quote));
    }
    expect(quote.valid, `the venue's own ${feeMode}-fee dry-run for ISSUE ${ISSUE_TICK} disagrees `
        + `with this spec's premise: ${JSON.stringify(quote)}`).toBe(expected);
    if (feeMode === 'xchain') {
        expect(Number(quote.feeTokenBalance), `the venue measured a different XCHAIN balance: ${JSON.stringify(quote)}`)
            .toBe(EXPECTED_XCHAIN_BALANCE);
        expect(quote.feeAffordable, `the venue considers the ISSUE fee affordable: ${JSON.stringify(quote)}`)
            .toBe(false);
    }
}

/**
 * Scans the confirm surface in both of its §4.2 verdict states.
 *
 * One test per width rather than one per state: the expensive part is
 * funding, and both states are reachable from the same wallet by changing the
 * protocol-fee lane.
 */
async function scanBothVerdicts(page, own, width) {
    await warmIssue(own, true, 'native');
    await composeIssue(page, { nativeFee: true });
    await expect(page.getByTestId('preflight-chip')).toHaveText('Looks good');
    await scan(page, `Confirm surface (ready, ${width})`);
    await page.getByTestId('confirm-reject').click();

    await warmIssue(own, false);

    // The fail state is its own scan target, not a variation: it is the only
    // one that renders the error list, the per-finding "Sign anyway"
    // checkboxes and `aria-live="assertive"`, and it is the state a user is
    // most likely to be reading carefully. An unlabelled override control
    // here is a consent problem, not a lint finding.
    await composeIssue(page, { nativeFee: false });
    await expect(page.getByTestId('preflight-chip')).toHaveText('Will likely fail');
    await expect(page.getByTestId('ack-DRYRUN_INVALID')).toBeVisible();
    await scan(page, `Confirm surface (pre-flight fail, ${width})`);
}

test.describe('a11y: confirm surface, full width (§5.2)', () => {
    test('both verdict states scan clean', async ({ page }) => {
        const own = await nativeFundedWallet(page);
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
        const own = await nativeFundedWallet(page);
        await scanBothVerdicts(page, own, 'popup');
    });
});
