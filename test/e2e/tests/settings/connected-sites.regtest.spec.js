// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Settings sub-pages" -> the CONNECTED SITES sub-page.
//
// WHAT THIS VENUE CAN AND CANNOT REACH, stated first because it changes what
// the spec is allowed to claim. A `ConnectedSite` record is written in exactly
// one place, `extension/src/bridge/handlers.js`, on an approved `bridge.connect`
// from a dApp. In the WEB shell that path has no transport: the in-page host
// registers the bridge handlers (hostBridge builds it with the same
// `createBackgroundHost`), but nothing relays a page's `window.xchain` call
// into it - there is no content script, no `postMessage` listener, and no
// `window`-exposed host. So on this venue the site list is EMPTY BY
// CONSTRUCTION, and a spec that drove a disconnect here would be testing a row
// it had to invent. The per-site Disconnect / Block / Permissions controls
// therefore belong to the extension venue, and are named as an open gap rather
// than faked.
//
// WHAT IS REACHABLE IS THE OTHER HALF OF THE SAME PANEL, and it is the half
// that answers the row's question - does a revocation REVOKE, or does it only
// remove a row. The blocklist (§12 / G009) is the panel's standing revocation:
// an origin on it "cannot connect or ask you to sign anything until you remove
// them from this list". It is user-writable from this screen with no dApp
// involved, so the whole write / persist / re-read / withdraw cycle is drivable
// here, and that cycle is where the documented failure mode of this area lives.
//
// THE FAILURE MODE, twice measured: D-70 (theme / reduced motion /
// hide-small-balances) and D-91 (the endpoints editor) are the same
// bug - a control that PERSISTS its value while NOTHING APPLIES it. The method
// that separates the two is the one used below: change it, RELOAD, then check
// both that the control kept the value AND that something OTHER than the
// control's own list agrees. Either check alone is ambiguous.
//
// So the second reader here is the BLOCKLIST AUDIT LOG. It matters that it is
// a different record read back through a different host route
// (`sites.auditLog.list` -> `settings.blocklistAuditLog`) than the list itself
// (`sites.listBlocked` -> `settings.blockedOrigins`): a component that had
// merely repainted its own state, or a write that had touched the list without
// going through `addBlockedOrigin`, cannot produce an audit entry. The audit
// log is the evidence that the flow RAN, not just that the row appeared.
//
// AND THE WITHDRAWAL IS DRIVEN AS A PAIR, because "unblock" has two ways to be
// wrong and only one of them is visible in a single-entry test: it can fail to
// persist (the row comes back on reload), or it can take out MORE than it was
// asked to (the list is cleared rather than filtered). Two entries go in, one
// comes out, and both facts are re-read after a reload.
//
// TWO THINGS THIS SPEC MEASURED AND DOES NOT ASSERT AS CORRECT, recorded here
// so the next reader does not mistake them for oversights - both are reported
// as defects, and fixing them is not this spec's job:
//   1. The audit panel does not refresh after a mutation made on its own
//      screen. `BlocklistAuditPanel` loads once on mount; the parent's
//      `reload()` after a block/unblock does not reach it. The log therefore
//      still reads "No mutations yet." immediately after the user blocks
//      something, and only catches up on a remount. Every audit assertion below
//      is deliberately taken AFTER a reload for that reason.
//   2. The panel's own caption says "Recent blocklist mutations (most recent
//      last)" while `[...entries].reverse()` renders them most recent FIRST.
//      The spec pins the rendered order, which is the behaviour; the caption is
//      the thing that is wrong.
//
// NO CHAIN. Nothing broadcasts, funds or indexes: this is settings + UI only.
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RBTC XC_PREVIEW_PORT=4184 XC_REUSE_BUILD=1 \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/settings/connected-sites.regtest.spec.js

import { createWallet, expect, openSettings, test } from '../../fixtures/wallet.js';
import { unlockAfterReload } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';

// An exact origin and a wildcard pattern: the two shapes
// `normalizeBlocklistEntry` handles differently (an origin is round-tripped
// through `URL.origin`, a wildcard is stored verbatim), so blocking one of each
// keeps the withdrawal test honest about which entry it took out.
const ORIGIN = 'https://evil-e2e.example';
const WILDCARD = '*.wild-e2e.example';

/** Opens Settings and walks into the Connected Sites sub-page. */
async function openConnectedSites(page) {
    await openSettings(page);
    // Scoped to `main` and asserted visible BEFORE the click: the primary
    // navigation carries same-named destinations, and a Playwright click has no
    // default action timeout, so a miss hangs out the whole test budget rather
    // than failing.
    const row = page.getByRole('main').getByRole('button', { name: /^Connected Sites/ }).first();
    await expect(row, 'Settings has no Connected Sites row').toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByLabel('Origin or wildcard to block'),
        'the Connected Sites sub-page did not open').toBeVisible({ timeout: 30_000 });
}

/**
 * A row in the "Blocked origins" list.
 *
 * Matched by TEXT and then narrowed by the Unblock button it contains, and both
 * halves are load-bearing. The rows are `role="listitem"`, which is not a
 * name-from-content role, so they carry no accessible name at all
 * (`getByRole('listitem', { name })` matches nothing here). And the audit log
 * below renders the same origin string inside listitems of its own, so text
 * alone matches two different panels; only the blocked-origins row owns an
 * Unblock button.
 */
function blockedRow(page, entry) {
    return page.getByRole('main').getByRole('listitem')
        .filter({ hasText: entry })
        .filter({ has: page.getByRole('button', { name: 'Unblock', exact: true }) });
}

/** The audit-log rows: the listitems in `main` that are NOT blocked-origin rows. */
function auditRows(page) {
    return page.getByRole('main').getByRole('listitem')
        .filter({ hasNot: page.getByRole('button', { name: 'Unblock', exact: true }) });
}

/** Blocks `entry` through the panel's own manual-block form. */
async function blockEntry(page, entry) {
    const field = page.getByLabel('Origin or wildcard to block');
    await expect(field, 'the Connected Sites panel offers no way to block an origin')
        .toBeVisible({ timeout: 30_000 });
    await field.fill(entry);
    const submit = page.getByRole('main').getByRole('button', { name: 'Block', exact: true });
    await expect(submit, 'the manual-block form has no Block button').toBeVisible({ timeout: 30_000 });
    await submit.click();
}

test.describe('Settings: connected sites', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(600_000);

    test('the panel reports an empty connection list, and a blocked origin is really blocked - and really let go',
        async ({ page }) => {
            await createWallet(page, { password: PASSWORD, name: 'Connected Sites Wallet' });

            await test.step('the panel is WIRED, and reports no connections', async () => {
                await openConnectedSites(page);
                const main = page.getByRole('main');

                // The distinction that matters on an empty screen: "nothing is
                // connected" and "this shell could not ask" render as different
                // strings, and only the first one means the host route answered.
                await expect(main.getByText(/Connected sites unavailable/),
                    'the Connected Sites panel could not read the site list at all, so everything '
                    + 'below it is describing an error state rather than an empty one')
                    .toHaveCount(0);
                await expect(main.getByText(/not wired in this shell yet/),
                    'the connected-sites host route is missing in this shell')
                    .toHaveCount(0);
                await expect(main.getByText(/^No dApps connected/),
                    'the panel neither listed connections nor reported that there are none')
                    .toBeVisible({ timeout: 30_000 });

                // The blocklist half of the panel is present and reachable -
                // it is gated on three messaging routes existing at once
                // (`blocklistWired`), so its absence would be silent.
                await expect(main.getByText('Blocked origins', { exact: true }),
                    'the panel has no Blocked origins section, so this shell is missing at least one '
                    + 'of the three blocklist routes it is gated on')
                    .toBeVisible({ timeout: 30_000 });
                await expect(main.getByText('No origins blocked.', { exact: true }),
                    'the blocklist did not report its empty state')
                    .toBeVisible({ timeout: 30_000 });
            });

            await test.step('two origins are blocked from the panel itself', async () => {
                await blockEntry(page, ORIGIN);
                await expect(blockedRow(page, ORIGIN),
                    'blocking an origin did not put it on the blocked list')
                    .toBeVisible({ timeout: 30_000 });
                await expect(page.getByLabel('Origin or wildcard to block'),
                    'the manual-block field kept its text after a successful block, so a second '
                    + 'submit would re-block the same origin')
                    .toHaveValue('');

                await blockEntry(page, WILDCARD);
                await expect(blockedRow(page, WILDCARD),
                    'a wildcard pattern was refused or silently dropped by the blocklist, while the '
                    + 'panel\'s own hint tells the user to use exactly this shape')
                    .toBeVisible({ timeout: 30_000 });
                await expect(page.getByRole('main').getByText('No origins blocked.', { exact: true }),
                    'the blocklist still claims to be empty with two entries on it')
                    .toHaveCount(0);
            });

            await test.step('they SURVIVE a reload, and the audit log agrees they were written', async () => {
                // A reload, not a re-render: before it, a passing read could be
                // served by the component's own state; after it, the only thing
                // that can put these rows back is a vault the write reached.
                await page.reload();
                await unlockAfterReload(page, PASSWORD);
                await openConnectedSites(page);

                await expect(blockedRow(page, ORIGIN),
                    'a blocked origin did not survive a reload, so the block was never persisted and '
                    + 'the site is free to ask again on the next launch')
                    .toBeVisible({ timeout: 30_000 });
                await expect(blockedRow(page, WILDCARD),
                    'a blocked wildcard pattern did not survive a reload')
                    .toBeVisible({ timeout: 30_000 });

                // The second reader. This record is written only by
                // `addBlockedOrigin`, and it is fetched by a different host
                // route than the list above - so a row that appeared without
                // the flow running cannot produce it. Newest first, per the
                // panel's `.reverse()` (its caption says otherwise; see header).
                const newest = auditRows(page).first();
                await expect(newest, 'the blocklist audit log recorded nothing at all, so the rows on '
                    + 'screen did not come from the blocklist flow')
                    .toBeVisible({ timeout: 30_000 });
                const newestText = (await newest.innerText()).trim();
                expect(newestText.includes(WILDCARD),
                    'the newest audit entry is not the wildcard that was blocked last')
                    .toBe(true);
                // `\bblock\b` does not match "unblock" - the b is preceded by a
                // word character there - so this really does separate the two.
                expect(/\bblock\b/.test(newestText),
                    'the audit log recorded the wildcard block as something other than a block')
                    .toBe(true);

                await expect(auditRows(page).filter({ hasText: ORIGIN }),
                    'the exact origin was blocked but the audit log has no entry for it')
                    .toHaveCount(1);
            });

            await test.step('Unblock withdraws ONE entry, and the withdrawal is the one that persists',
                async () => {
                    await blockedRow(page, ORIGIN)
                        .getByRole('button', { name: 'Unblock', exact: true }).click();

                    await expect(blockedRow(page, ORIGIN),
                        'Unblock left the origin on the blocked list')
                        .toHaveCount(0, { timeout: 30_000 });
                    await expect(blockedRow(page, WILDCARD),
                        'unblocking ONE origin took the other entry off the list too, so the user who '
                        + 'lets one site back in silently lets them all back in')
                        .toBeVisible({ timeout: 30_000 });

                    // The mirror of the persistence check above, and the half
                    // that catches "the row was removed and nothing else": if
                    // the delete never reached the vault, the reload puts the
                    // blocked origin back and the user is quietly still blocking
                    // a site they chose to trust.
                    await page.reload();
                    await unlockAfterReload(page, PASSWORD);
                    await openConnectedSites(page);

                    await expect(blockedRow(page, ORIGIN),
                        'the unblocked origin came back after a reload, so Unblock removed the ROW and '
                        + 'not the block - the D-70 / D-91 shape this area keeps producing, with the '
                        + 'sign flipped')
                        .toHaveCount(0, { timeout: 30_000 });
                    await expect(blockedRow(page, WILDCARD),
                        'the entry that was NOT unblocked is gone after a reload')
                        .toBeVisible({ timeout: 30_000 });

                    const newest = auditRows(page).first();
                    const newestText = (await newest.innerText()).trim();
                    expect(newestText.includes(ORIGIN),
                        'the newest audit entry is not the origin that was just unblocked')
                        .toBe(true);
                    expect(/\bunblock\b/.test(newestText),
                        'the withdrawal was not recorded as an unblock in the audit log, so the record '
                        + 'of who was let back in - the one thing that log exists for - is wrong')
                        .toBe(true);
                });
        });
});
