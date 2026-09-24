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

import { createWallet, expect, test } from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    nudgeChain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);

/** Opens the command palette and runs the named command. */
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

/** Approves the open confirm screen and returns the broadcast txid. */
async function approveAndGetTxid(page) {
    await page.getByTestId('confirm-approve').click();
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

/**
 * Opens Manage Token for `tick` and clicks the named action. Manage Token
 * splits its actions between page buttons and a "More" overflow menu
 * once there are more than three, so both are checked (same split
 * `collectible-one-of-one.regtest.spec.js` already reads around).
 */
async function openManageTokenAction(page, tick, label) {
    await gotoPalette(page, 'My Tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(page.getByText('Manage Token').first()).toBeVisible({ timeout: 30_000 });

    const primary = main.getByRole('button', { name: label, exact: true });
    if (await primary.count() > 0 && await primary.first().isVisible()) {
        await primary.first().click();
        return;
    }
    const more = main.getByRole('button', { name: /^More/ });
    await expect(more, `Manage Token offers neither a "${label}" button nor a More menu`)
        .toBeVisible({ timeout: 15_000 });
    await more.first().click();
    const item = page.getByRole('menuitem', { name: label, exact: true });
    await expect(item, `no "${label}" action available for ${tick}`).toBeVisible({ timeout: 15_000 });
    await item.click();
}

/** Issues `tick` on the venue chain from `source` and returns its ISSUE action index. */
async function issueToken(page, source, tick) {
    await gotoPalette(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(main.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    expect(await main.getByLabel('From').inputValue(),
        `the Issue token form defaulted away from ${source}, so the issued token would not be owned `
        + 'by the address this test funded')
        .toBe(source);
    await main.getByLabel('Ticker').fill(tick);
    await main.getByLabel('Supply', { exact: true }).fill(SUPPLY);
    const password = main.getByLabel('Password', { exact: true });
    if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();

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

        await test.step('shared fixture: onboard, fund, issue a token, attach content (FILE then LINK)', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Content Registry Wallet' });
            await switchToRegtest(page, PASSWORD);

            await gotoPalette(page, 'Issue token');
            const issueMain = page.getByRole('main');
            await expect(issueMain.getByLabel('Ticker')).toBeVisible({ timeout: 30_000 });
            await selectVenueChain(issueMain);
            source = await issueMain.getByLabel('From').inputValue();
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, FUNDING);
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
            await page.getByRole('button', { name: 'Review upload', exact: true }).click();

            const fileMain = page.getByRole('main');
            await expect(fileMain.getByRole('button', { name: 'Upload file', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            const filePassword = fileMain.getByLabel('Password', { exact: true });
            if (await filePassword.count() > 0 && await filePassword.isVisible()) await filePassword.fill(PASSWORD);
            await fileMain.getByRole('button', { name: 'Upload file', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const fileTxid = await approveAndGetTxid(page);
            const fileAction = await waitForValidAction(fileTxid);
            fileActionIndex = String(fileAction.action_index);

            await expect(page.getByText('File is on its way', { exact: true }).first())
                .toBeVisible({ timeout: 30_000 });
            const linkButton = page.getByRole('button', { name: `Link artwork to ${TICK}`, exact: true });
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await linkButton.isVisible().catch(() => false)) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            await expect(linkButton,
                'the wallet never advanced past "File is on its way"; the FILE is on chain '
                + '(see the txid above), so this is the wait-index poll, not the broadcast')
                .toBeVisible({ timeout: 60_000 });

            const linkPassword = page.getByRole('main').getByLabel('Password', { exact: true });
            if (await linkPassword.count() > 0 && await linkPassword.isVisible()) await linkPassword.fill(PASSWORD);
            await linkButton.click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const linkTxid = await approveAndGetTxid(page);
            await waitForValidAction(linkTxid);

            await expect(page.getByText('Artwork attached', { exact: true }).first())
                .toBeVisible({ timeout: 30_000 });

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
            await gotoPalette(page, 'All actions');
            await page.getByRole('main').getByText('Link cross-chain actions', { exact: true })
                .first().click();

            const panelA = page.locator('fieldset').filter({ hasText: 'Chain A' });
            const panelB = page.locator('fieldset').filter({ hasText: 'Chain B' });
            await selectVenueChain(panelA, 'Chain');
            await selectVenueChain(panelB, 'Chain');
            await panelA.getByLabel('Action to reference').fill(issueActionIndex);
            await panelB.getByLabel('Action to reference').fill(fileActionIndex);

            const main = page.getByRole('main');
            const password = main.getByLabel('Password', { exact: true });
            const linkAction = main.getByRole('button', { name: 'Link', exact: true });
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
                'LinkForm did not encode Chain A\'s action number as COIN1_ACTION_INDEX')
                .toBe(issueActionIndex);
            expect(String(linked.coin2_action_index),
                'LinkForm did not encode Chain B\'s action number as COIN2_ACTION_INDEX')
                .toBe(fileActionIndex);
        });

        await test.step('the list manager: create, fork, and read the membership back from ListDetail', async () => {
            await gotoPalette(page, 'Create a list');
            const main = page.getByRole('main');
            await selectVenueChain(main);
            await main.getByRole('textbox').first().fill(source);
            await expect(main).toContainText('1 valid address');
            await main.getByRole('button', { name: 'Publish list', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const createTxid = await approveAndGetTxid(page);
            const created = await waitForValidAction(createTxid);
            const listActionIndex = String(created.action_index);

            await gotoPalette(page, 'My Lists');
            const listRow = page.getByRole('button', { name: `Open address list #${listActionIndex}` });
            await expect(listRow, `the list just published (#${listActionIndex}) is not in My Lists`)
                .toBeVisible({ timeout: 60_000 });
            await listRow.click();

            await expect(page.getByText(/^Members as published \(1\)$|^Current members \(1\)$/))
                .toBeVisible({ timeout: 30_000 });
            await expect(page.getByRole('main')).toContainText(source);

            await page.getByRole('button', { name: 'Fork & edit', exact: true }).click();
            const forkMain = page.getByRole('main');
            await expect(forkMain.getByRole('button', { name: 'Review', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            await forkMain.getByLabel(/^Add addresses/).fill(source);
            await forkMain.getByRole('button', { name: 'Review', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const forkTxid = await approveAndGetTxid(page);
            const forked = await waitForValidAction(forkTxid);
            const forkActionIndex = String(forked.action_index);

            await gotoPalette(page, 'My Lists');
            const forkRow = page.getByRole('button', { name: `Open address list #${forkActionIndex}` });
            await expect(forkRow, `the fork just published (#${forkActionIndex}) is not in My Lists`)
                .toBeVisible({ timeout: 60_000 });
            await forkRow.click();
            await expect(page.getByText(`Forked from #${listActionIndex}`, { exact: false }))
                .toBeVisible({ timeout: 30_000 });
        });

        await test.step('the project roster: publish a token list and link it to the project', async () => {
            const PROJECT = `PRJ${STAMP}`;
            const MEMBER = `MEM${STAMP}`;
            await issueToken(page, source, PROJECT);
            await issueToken(page, source, MEMBER);

            await openManageTokenAction(page, PROJECT, 'Official list');
            const rosterMain = page.getByRole('main');
            await expect(rosterMain.getByLabel('Tokens (one per line)')).toBeVisible({ timeout: 30_000 });
            await rosterMain.getByLabel('Tokens (one per line)').fill(MEMBER);
            await rosterMain.getByRole('button', { name: 'Review list', exact: true }).click();

            await expect(rosterMain.getByRole('button', { name: 'Publish list', exact: true }))
                .toBeVisible({ timeout: 30_000 });
            const listPassword = rosterMain.getByLabel('Password', { exact: true });
            if (await listPassword.count() > 0 && await listPassword.isVisible()) await listPassword.fill(PASSWORD);
            await rosterMain.getByRole('button', { name: 'Publish list', exact: true }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const listTxid = await approveAndGetTxid(page);
            const listAction = await waitForValidAction(listTxid);
            const rosterListIndex = String(listAction.action_index);

            await expect(page.getByText('List is on its way', { exact: true }).first())
                .toBeVisible({ timeout: 30_000 });
            const officialButton = page.getByRole('button', { name: 'Make it official', exact: true });
            const deadline = Date.now() + 300_000;
            while (Date.now() < deadline) {
                if (await officialButton.isVisible().catch(() => false)) break;
                await nudgeChain();
                await new Promise((r) => setTimeout(r, 2_000));
            }
            await expect(officialButton,
                'the wallet never advanced past "List is on its way"; the LIST is on chain '
                + '(see the txid above), so this is the wait-index poll, not the broadcast')
                .toBeVisible({ timeout: 60_000 });

            const linkPassword = page.getByRole('main').getByLabel('Password', { exact: true });
            if (await linkPassword.count() > 0 && await linkPassword.isVisible()) await linkPassword.fill(PASSWORD);
            await officialButton.click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const rosterLinkTxid = await approveAndGetTxid(page);
            await waitForValidAction(rosterLinkTxid);

            const rows = await explorerJson(`links/${source}/address`);
            const list = Array.isArray(rows?.data) ? rows.data : Array.isArray(rows) ? rows : [];
            const linked = list.find((r) => r.tx_hash === rosterLinkTxid);
            expect(linked, `the roster LINK is not on the explorer's links list for ${source}`).toBeTruthy();
            expect(String(linked.coin1_action_index),
                'the roster LINK did not encode the token-list index as COIN1_ACTION_INDEX')
                .toBe(rosterListIndex);
        });
    });
});
