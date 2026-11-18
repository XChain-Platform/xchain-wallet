// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The content and registry flows: attach artwork to a token, link two
// arbitrary actions across chains, publish and fork an address list
// (reading the resulting membership back from ListDetail), and publish
// a project's official-token roster.
//
// AttachContentForm and ProjectRosterForm are both bespoke two-signature
// stage machines (compose -> review-file/list -> wait-index -> review-link
// -> done), each ending in the same shape: a FILE or LIST goes on chain
// first, the wallet polls the explorer for its own ACTION_INDEX, then a
// LINK is signed pairing that index with the token's ISSUE. Rather than
// pay for that setup four times, ONE issue + FILE + LINK is built here
// and its action indices are reused by the Link test (which drives
// LinkForm directly, pairing the same two actions in the opposite
// order) and the list manager test builds its own list independently,
// since a list has nothing to do with a token's genesis record.
//
// Every step asserts an ON-CHAIN read (waitForValidAction, the
// explorer's /links or /sleeps rows, or the wallet's own ListDetail
// screen, which is itself backed by a live indexer read) rather than
// only the form's own success copy.

import {
    clickManageTokenAction,
    createWallet,
    expect,
    expectMyTokensRow,
    openFormSection,
    openPaletteCommand,
    test,
} from '../../fixtures/wallet.js';
import { waitForShownTxid } from '../../fixtures/pendingHistory.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    issuePlainToken,
    readIssueSource,
    mintXchain,
    nudgeChain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    REGTEST_DESTINATION,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
// Off Bitcoin the protocol fee is paid in the native coin: about 20 DOGE per
// fee-bearing action at the venue's seeded DOGE price, and this test makes
// about ten of them, so one DOGE cannot even pay for the first ISSUE.
const FUNDING = REGTEST_COIN === 'RDOGE' ? 1000 : 1;
const SUPPLY = '1000';
/** Pays the XCHAIN protocol fee on the three ISSUEs, the FILE, three LINKs and three LISTs, with room to spare. */
const MINT_XCHAIN = 100;
const STAMP = Date.now().toString().slice(-6);

/** Approves the open confirm screen and returns the broadcast txid. */
async function approveAndGetTxid(page) {
    await approveConfirm(page);
    return waitForShownTxid(page.getByRole('main'), { message: 'no transaction id ever appeared after Approve' });
}

/**
 * Approves the open confirm screen and returns the txid printed under
 * `label` on the flow's done screen. A two-signature flow's wait-index
 * screen already prints the FIRST transaction's hash behind the confirm, so
 * the generic read above would return that one for the LINK; this waits for
 * the done heading and reads the labelled hash instead.
 */
async function approveAndReadTxid(page, doneHeading, label = 'Link transaction') {
    await approveConfirm(page);
    return readLabelledTxid(page, doneHeading, label);
}

/** Waits for `doneHeading` and returns the txid the screen prints under `label`. */
async function readLabelledTxid(page, doneHeading, label = 'Link transaction') {
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: doneHeading, exact: true }),
        `the flow never reached "${doneHeading}" after Approve`)
        .toBeVisible({ timeout: 180_000 });
    const txid = (await main.locator(`p:text-is("${label}") + code`).innerText()).trim();
    expect(txid, `"${doneHeading}" printed no ${label} hash`).toMatch(/^[0-9a-f]{64}$/);
    return txid;
}

/**
 * Opens Manage Token for `tick` and clicks the named action. Manage Token
 * splits its actions between page buttons and a "More" overflow menu
 * once there are more than three, so both are checked (same split
 * `collectible-one-of-one.regtest.spec.js` already reads around).
 */
/**
 * The My Lists row that opens list `index`.
 *
 * The accessible name sits on the row's button, not on its list item, and it
 * follows the list's name: "Open address list #N" while unnamed, and
 * "Open <name> (List #N)" once a rename has landed.
 */
function myListsRow(page, index) {
    return page.getByRole('button', {
        name: new RegExp(`^Open (address list #${index}|.* \\(List #${index}\\))$`),
    });
}

async function openManageTokenAction(page, tick, label) {
    await openPaletteCommand(page, 'My tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expectMyTokensRow(main, row, `${tick} is on chain but My Tokens does not list it`);
    await row.click();
    await expect(page.getByText('Manage Token').first()).toBeVisible({ timeout: 30_000 });

    await clickManageTokenAction(main, label);
}

/** Issues `tick` on the venue chain from `source` and returns its ISSUE action index. */
async function issueToken(page, source, tick) {
    // Opening Issue token from the palette while its own "Token issued" screen
    // is showing keeps that screen (same view, no remount), so a second issue in
    // a row would find no Ticker field. Leave for another view first.
    await openPaletteCommand(page, 'My tokens');
    await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
    expect(await readIssueSource(main),
        `the Issue token form defaulted away from ${source}, so the issued token would not be owned `
        + 'by the address this test funded')
        .toBe(source);
    await issuePlainToken(main, { ticker: tick, supply: SUPPLY, password: PASSWORD });

    await expectConfirmModal(page, 'this action', 60_000);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    const txid = await approveAndGetTxid(page);
    const action = await waitForValidAction(txid);
    return { txid, actionIndex: String(action.action_index) };
}

test.describe(`content and registry flows on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('attach content, Link, the list manager and the project roster', async ({ page }) => {
        const TICK = `CNT${STAMP}`;
        let source;
        let fileActionIndex;
        let issueActionIndex;
        let managedListIndex;

        await test.step('shared fixture: onboard, fund, issue a token, attach content (FILE then LINK)', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Content Registry Wallet' });
            await switchToRegtest(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            const issueMain = page.getByRole('main');
            await expect(fieldByLabel(issueMain, 'Ticker')).toBeVisible({ timeout: 30_000 });
            source = await readIssueSource(issueMain);
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            // Every action below charges an XCHAIN protocol fee, and the preflight
            // disables Approve on a wallet that holds none.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            const issued = await issueToken(page, source, TICK);
            issueActionIndex = issued.actionIndex;

            await openManageTokenAction(page, TICK, 'Artwork');
            await expect(page.getByText(`Attach artwork to ${TICK}`)).toBeVisible({ timeout: 30_000 });

            await page.setInputFiles('input[aria-label="Choose file to attach"]', {
                name: 'nft.svg',
                mimeType: 'image/svg+xml',
                buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
            });
            await page.getByRole('button', { name: 'Attach Artwork', exact: true }).click();

            const fileMain = page.getByRole('main');
            await expect(fileMain.getByRole('button', { name: 'Upload File', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            const filePassword = fieldByLabel(fileMain, 'Password');
            if (await filePassword.count() > 0 && await filePassword.isVisible()) await filePassword.fill(PASSWORD);
            await fileMain.getByRole('button', { name: 'Upload File', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            // After Approve the form shows "File is on its way" with the FILE txid
            // until its own index poll clears, which on a quiet chain can happen
            // before a check for it runs. So nothing is read here: the wait is on
            // the LINK leg's button, and both txids come off the done screen.
            await approveConfirm(page);
            const linkButton = page.getByRole('button', { name: `Link Artwork to ${TICK}`, exact: true });
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await linkButton.isVisible().catch(() => false)) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            await expect(linkButton,
                'the wallet never advanced past "File is on its way"; either the FILE never '
                + 'broadcast or the wait-index poll never saw it indexed')
                .toBeVisible({ timeout: 60_000 });

            const linkPassword = fieldByLabel(page.getByRole('main'), 'Password');
            if (await linkPassword.count() > 0 && await linkPassword.isVisible()) await linkPassword.fill(PASSWORD);
            await linkButton.click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const linkTxid = await approveAndReadTxid(page, 'Artwork attached');
            const fileTxid = await readLabelledTxid(page, 'Artwork attached', 'File transaction');
            fileActionIndex = String((await waitForValidAction(fileTxid)).action_index);
            await waitForValidAction(linkTxid);

            const rows = await explorerJson(`links/${source}/address`);
            const list = Array.isArray(rows?.data) ? rows.data : Array.isArray(rows) ? rows : [];
            const linked = list.find((r) => r.tx_hash === linkTxid);
            expect(linked, 'the LINK the attach-content flow broadcast is not on the explorer\'s '
                + `links list for ${source}`).toBeTruthy();
            expect(String(linked.coin1_action_index)).toBe(fileActionIndex);
            expect(String(linked.coin2_action_index)).toBe(issueActionIndex);
            expect(String(linked.status)).toBe('valid');
        });

        await test.step('Link: pair the same two actions again, in the opposite order', async () => {
            await openPaletteCommand(page, 'All actions');
            await page.getByRole('main').getByText('Link cross-chain actions', { exact: true })
                .first().click();

            // LinkForm's two cards, "Action 1" and "Action 2": each holds its
            // own Network field and an "Action number" looked up on leaving it.
            const actionCard = (n) => page.locator('fieldset')
                .filter({ has: page.locator('legend', { hasText: `Action ${n}` }) });
            const panelA = actionCard(1);
            const panelB = actionCard(2);
            await selectVenueChain(panelA, 'Network');
            await selectVenueChain(panelB, 'Network');
            for (const [n, panel, index] of [[1, panelA, issueActionIndex], [2, panelB, fileActionIndex]]) {
                const field = fieldByLabel(panel, 'Action number');
                await field.fill(index);
                await field.blur();
                await expect(panel.locator(`[aria-label="Action ${n} details"]`),
                    `the Link form found no action #${index} on this network for Action ${n}`)
                    .toBeVisible({ timeout: 60_000 });
            }

            const main = page.getByRole('main');
            const password = fieldByLabel(main, 'Password');
            const linkAction = main.getByRole('button', { name: 'Link Actions', exact: true });
            await linkAction.click();
            if (await password.count() > 0 && await password.isVisible()) {
                await password.fill(PASSWORD);
                await linkAction.click();
            }

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);

            const rows = await explorerJson(`links/${source}/address`);
            const list = Array.isArray(rows?.data) ? rows.data : Array.isArray(rows) ? rows : [];
            const linked = list.find((r) => r.tx_hash === txid);
            expect(linked, `the LinkForm broadcast is not on the explorer's links list for ${source}`)
                .toBeTruthy();
            expect(String(linked.coin1_action_index),
                'LinkForm did not encode Network A\'s action number as COIN1_ACTION_INDEX')
                .toBe(issueActionIndex);
            expect(String(linked.coin2_action_index),
                'LinkForm did not encode Network B\'s action number as COIN2_ACTION_INDEX')
                .toBe(fileActionIndex);
        });

        await test.step('the list manager: create, fork, and read the membership back from ListDetail', async () => {
            await openPaletteCommand(page, 'Create a list');
            const main = page.getByRole('main');
            await selectVenueChain(main);
            // The first textbox on this form is the read-only From field; the
            // members go in the paste area, which has no label of its own.
            await main.getByPlaceholder('Paste addresses, one per line or comma-separated.').fill(source);
            await expect(main).toContainText('1 valid address');
            await main.getByRole('button', { name: 'Publish List', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const createTxid = await approveAndGetTxid(page);
            const created = await waitForValidAction(createTxid);
            const listActionIndex = String(created.action_index);
            managedListIndex = listActionIndex;

            await openPaletteCommand(page, 'My lists');
            const listRow = myListsRow(page, listActionIndex);
            await expect(listRow, `the list just published (#${listActionIndex}) is not in My Lists`)
                .toBeVisible({ timeout: 60_000 });
            await listRow.click();

            await expect(page.getByText(/^Members as published \(1\)$|^Current members \(1\)$/))
                .toBeVisible({ timeout: 30_000 });
            await expect(page.getByRole('main')).toContainText(source);

            await page.getByRole('list', { name: 'List actions' }).getByRole('button', { name: /^Fork\b/ }).click();
            const forkMain = page.getByRole('main');
            await expect(forkMain.getByRole('button', { name: 'Publish Fork', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            // The fork adds a member the parent does not already hold: the List form's Fork
            // drops additions that are already on the list, so re-adding `source`
            // would leave nothing to publish and Publish Fork disabled.
            await fieldByLabel(forkMain, 'Addresses').fill(REGTEST_DESTINATION);
            await forkMain.getByRole('button', { name: 'Publish Fork', exact: true }).click();

            const publishAdd = forkMain.getByRole('button', { name: 'Publish Add', exact: true });
            await expect(publishAdd).toBeVisible({ timeout: 30_000 });
            const forkPassword = fieldByLabel(forkMain, 'Password');
            if (await forkPassword.count() > 0 && await forkPassword.isVisible()) await forkPassword.fill(PASSWORD);
            await publishAdd.click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const forkTxid = await approveAndReadTxid(page, 'Fork submitted', 'Fork transaction');
            const forked = await waitForValidAction(forkTxid);
            const forkActionIndex = String(forked.action_index);

            await openPaletteCommand(page, 'My lists');
            const forkRow = myListsRow(page, forkActionIndex);
            await expect(forkRow, `the fork just published (#${forkActionIndex}) is not in My Lists`)
                .toBeVisible({ timeout: 60_000 });
            await forkRow.click();
            // "Forked from" lives in a <dt> and "#N (...)" in the sibling <dd>
            // (ListDetail.jsx), two DOM nodes with no text of their own in
            // common, so this locates the label then reads its own value
            // rather than searching for one node holding both.
            const forkedFromValue = page.locator('dt:has-text("Forked from") + dd');
            await expect(forkedFromValue,
                `ListDetail for fork #${forkActionIndex} does not name #${listActionIndex} as its parent`)
                .toContainText(`#${listActionIndex}`, { timeout: 30_000 });
            await expect(page.getByRole('main'),
                `ListDetail for fork #${forkActionIndex} does not show the member it added`)
                .toContainText(REGTEST_DESTINATION);
        });

        await test.step('the list manager: rename the list, then transfer it to another owner', async () => {
            const NAME = `Roster ${STAMP}`;
            const openManagedList = async () => {
                await openPaletteCommand(page, 'My lists');
                const row = myListsRow(page, managedListIndex);
                await expect(row, `list #${managedListIndex} is not in My Lists`).toBeVisible({ timeout: 60_000 });
                await row.click();
            };

            await openManagedList();
            // List details read through the shared host gate, which holds every
            // read while the venue's per-IP limit is paused after a 429.
            // Renaming is the Edit action: its name and description sit in the
            // Details section, closed until used, and it publishes with Publish Edit.
            await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 90_000 });
            const renameMain = page.getByRole('main');
            await openFormSection(renameMain, 'Details');
            await fieldByLabel(renameMain, 'Name').fill(NAME);
            await renameMain.getByRole('button', { name: 'Publish Edit', exact: true }).click();
            const renamePassword = fieldByLabel(renameMain, 'Password');
            if (await renamePassword.count() > 0 && await renamePassword.isVisible()) await renamePassword.fill(PASSWORD);
            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const renameTxid = await approveAndGetTxid(page);
            await waitForValidAction(renameTxid);

            await expect.poll(async () => {
                const detail = await explorerJson(`action/${managedListIndex}`);
                return (detail?.data || detail)?.name;
            }, { message: `the explorer never showed the new name on list #${managedListIndex}`, timeout: 120_000 })
                .toBe(NAME);
            await openManagedList();
            await expect(page.locator('dt:has-text("Name") + dd'),
                'ListDetail does not show the name the rename published')
                .toContainText(NAME, { timeout: 30_000 });

            await page.getByRole('button', { name: 'Transfer List', exact: true }).click();
            const transferMain = page.getByRole('main');
            // The Transfer List form has no typed TRANSFER word any more: the
            // new owner is the only field before review (ListCreateForm, 2026-11-16).
            await fieldByLabel(transferMain, 'New owner').fill(REGTEST_DESTINATION);
            await transferMain.getByRole('button', { name: 'Transfer List', exact: true }).click();
            const transferPassword = fieldByLabel(transferMain, 'Password');
            if (await transferPassword.count() > 0 && await transferPassword.isVisible()) await transferPassword.fill(PASSWORD);
            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const transferTxid = await approveAndGetTxid(page);
            const transferred = await waitForValidAction(transferTxid);
            expect(String(transferred.status ?? 'valid')).toBe('valid');
        });

        await test.step('the project roster: publish a token list and link it to the project', async () => {
            const PROJECT = `PRJ${STAMP}`;
            const MEMBER = `MEM${STAMP}`;
            const project = await issueToken(page, source, PROJECT);
            await issueToken(page, source, MEMBER);

            await openManageTokenAction(page, PROJECT, 'Official list');
            const rosterMain = page.getByRole('main');
            const addToken = rosterMain.getByRole('button', { name: 'Add Token', exact: true });
            await expect(addToken).toBeVisible({ timeout: 30_000 });
            await expect(rosterMain.getByText('Loading the current project token list…', { exact: true }),
                'the wallet never finished checking the current official-token list')
                .toBeHidden({ timeout: 60_000 });
            // Each project token is a row added through the token picker.
            await addToken.click();
            await expect(page.locator('[data-balance-key]').first(),
                'the token picker listed nothing at all, so its balances never arrived')
                .toBeVisible({ timeout: 60_000 });
            // The search box sits behind the picker's Filter button.
            const search = page.getByLabel('Search coins or tokens', { exact: true });
            if (!(await search.isVisible().catch(() => false))) {
                await page.getByRole('button', { name: 'Filter coins and tokens', exact: true }).click();
            }
            await search.fill(MEMBER);
            await page.getByRole('button', { name: new RegExp(`^Select ${MEMBER}( on |$)`) }).first().click();
            await expect(rosterMain.getByRole('listitem').filter({ hasText: MEMBER })).toBeVisible({ timeout: 30_000 });
            await expect(rosterMain.getByRole('button', { name: `Remove ${MEMBER}`, exact: true })).toBeVisible();
            await rosterMain.getByRole('button', { name: 'Create and Link', exact: true }).click();

            await expect(rosterMain.getByRole('button', { name: 'Publish List', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            const listPassword = fieldByLabel(rosterMain, 'Password');
            if (await listPassword.count() > 0 && await listPassword.isVisible()) await listPassword.fill(PASSWORD);
            await rosterMain.getByRole('button', { name: 'Publish List', exact: true }).click();

            await approveConfirm(page);

            // After Approve the form shows "List is on its way", which the index
            // poll can clear before a check for it runs, so the wait is on the next
            // leg's button.
            const officialButton = page.getByRole('button', { name: 'Make It Official', exact: true });
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await officialButton.isVisible().catch(() => false)) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            await expect(officialButton,
                'the wallet never advanced past "List is on its way"; either the LIST never '
                + 'broadcast or the wait-index poll never saw it indexed')
                .toBeVisible({ timeout: 60_000 });

            const linkPassword = fieldByLabel(page.getByRole('main'), 'Password');
            if (await linkPassword.count() > 0 && await linkPassword.isVisible()) await linkPassword.fill(PASSWORD);
            await officialButton.click();
            await approveConfirm(page);

            const rosterLinkTxid = await readLabelledTxid(page, 'Official list published');
            const listTxid = await readLabelledTxid(page, 'Official list published', 'List transaction');
            const listAction = await waitForValidAction(listTxid);
            const rosterListIndex = String(listAction.action_index);
            await waitForValidAction(rosterLinkTxid);

            const rows = await explorerJson(`links/${source}/address`);
            const list = Array.isArray(rows?.data) ? rows.data : Array.isArray(rows) ? rows : [];
            const linked = list.find((r) => r.tx_hash === rosterLinkTxid);
            expect(linked, `the roster LINK is not on the explorer's links list for ${source}`).toBeTruthy();
            expect(String(linked.coin1_action_index),
                'the roster LINK did not encode the token-list index as COIN1_ACTION_INDEX')
                .toBe(rosterListIndex);
            expect(String(linked.coin2_action_index),
                'the roster LINK did not encode the project ISSUE index as COIN2_ACTION_INDEX')
                .toBe(project.actionIndex);
            expect(String(linked.status)).toBe('valid');
        });
    });
});
