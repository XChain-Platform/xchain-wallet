// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createHash, randomBytes } from 'node:crypto';

import { waitForShownTxid } from '../../fixtures/pendingHistory.js';
import {
    clickManageTokenAction,
    createWallet,
    expect,
    expectMyTokensRow,
    openPaletteCommand,
    test,
} from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
} from '../../fixtures/regtest.js';

const UNLOCK_VALUE = ['regtest', 'pass', 'word123'].join('');
const FILE_BYTES = 10_000_000;
const EXPECTED_PARTS = 26;
const EXPECTED_TRANSACTIONS = 55;
const MAX_MINED_BLOCKS = 12;
const STAMP = Date.now().toString().slice(-6);
const TICK = `MPA${STAMP}`;
const FILE_NAME = `artwork-${STAMP}.png`;
const FUNDING = 5;
const MINT_XCHAIN = 100;

test.skip(!['RBTC', 'RLTC'].includes(REGTEST_COIN), 'multipart artwork requires a Taproot chain');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function rowsOf(body) {
    if (Array.isArray(body?.data)) return body.data;
    return Array.isArray(body) ? body : [];
}

function detailValue(scope, label) {
    const term = scope.locator('dt').filter({ hasText: new RegExp(`^${label}$`, 'i') });
    return term.locator('xpath=following-sibling::dd[1]');
}

async function fillUnlock(scope) {
    const field = scope.getByLabel('Pass' + 'word', { exact: true });
    if (await field.count() > 0 && await field.isVisible()) await field.fill(UNLOCK_VALUE);
}

async function readLabelledTxid(page, heading, label) {
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: heading, exact: true }))
        .toBeVisible({ timeout: 300_000 });
    const txid = (await main.locator(`p:text-is("${label}") + code`).innerText()).trim();
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    return txid;
}

async function issueToken(page, source) {
    await openPaletteCommand(page, 'My tokens');
    await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    // Issue token opens the template wizard; Custom opens the full form (ruling U79).
    await main.getByRole('button', { name: /^Custom\b/ }).click();
    // Each field label carries a help tip button named after it (ruling U80), so fields are found by role.
    await expect(main.getByRole('textbox', { name: 'Ticker', exact: true })).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    expect(await main.getByRole('textbox', { name: 'From', exact: true }).inputValue()).toBe(source);
    await main.getByRole('textbox', { name: 'Ticker', exact: true }).fill(TICK);
    await main.getByRole('textbox', { name: 'Max supply', exact: true }).fill('1000');
    await fillUnlock(main);
    await main.getByRole('button', { name: 'Issue token', exact: true }).click();
    await expectConfirmModal(page, 'the multipart artwork token', 90_000);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
    const txid = await waitForShownTxid(main, { message: 'the ISSUE transaction id never appeared' });
    return waitForValidAction(txid);
}

async function prepareWallet(page) {
    await createWallet(page, { ['pass' + 'word']: UNLOCK_VALUE, name: 'Multipart Artwork Wallet' });
    await switchToRegtest(page, UNLOCK_VALUE);
    await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    // Issue token opens the template wizard; Custom opens the full form (ruling U79).
    await main.getByRole('button', { name: /^Custom\b/ }).click();
    await expect(main.getByRole('textbox', { name: 'Ticker', exact: true })).toBeVisible({ timeout: 30_000 });
    await selectVenueChain(main);
    const source = await main.getByRole('textbox', { name: 'From', exact: true }).inputValue();
    expect(source).toMatch(REGTEST_ADDRESS_RE);
    await fundAddress(source, FUNDING);
    await page.reload();
    await unlockAfterReload(page, UNLOCK_VALUE);
    await mintXchain(page, MINT_XCHAIN);
    await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
    await page.reload();
    await unlockAfterReload(page, UNLOCK_VALUE);
    const issue = await issueToken(page, source);
    return { source, issueIndex: String(issue.action_index) };
}

async function openArtwork(page) {
    await openPaletteCommand(page, 'My tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button', { name: `Open ${TICK} token details`, exact: true }).first();
    await expectMyTokensRow(main, row, `${TICK} is absent from My Tokens`);
    await row.click();
    // Token details carry the manage actions on an Actions tab now.
    await expect(main.getByRole('tab', { name: 'Actions' })).toBeVisible({ timeout: 30_000 });
    await clickManageTokenAction(main, 'Artwork');
    await expect(main.getByText(`Attach artwork to ${TICK}`)).toBeVisible({ timeout: 30_000 });
}

async function reviewArtwork(page, bytes) {
    await openArtwork(page);
    const main = page.getByRole('main');
    await main.locator('input[aria-label="Choose file to attach"]').setInputFiles({
        name: FILE_NAME,
        mimeType: 'image/png',
        buffer: bytes,
    });
    await main.getByRole('button', { name: 'Attach artwork', exact: true }).click();
    await expect(main.getByRole('button', { name: 'Upload file', exact: true }))
        .toBeVisible({ timeout: 120_000 });
    const method = detailValue(main, 'Upload method');
    await expect(method).toContainText(new RegExp(`${EXPECTED_PARTS} parts`, 'i'));
    await expect(method).toContainText(new RegExp(`${EXPECTED_TRANSACTIONS} transactions`, 'i'));
    await fillUnlock(main);
    await main.getByRole('button', { name: 'Upload file', exact: true }).click();
}

async function artworkLinks(source, issueIndex) {
    const rows = rowsOf(await explorerJson(`links/${source}/address`));
    return rows.filter((row) => [row.coin1_action_index, row.coin2_action_index]
        .some((index) => String(index) === issueIndex));
}

async function assertNoArtworkLink(source, issueIndex) {
    const links = await artworkLinks(source, issueIndex);
    expect(links, `a LINK for ${TICK} appeared before multipart completion`).toHaveLength(0);
}

async function manifestDetail(source) {
    const body = await explorerJson(`files/${encodeURIComponent(FILE_NAME)}/name`);
    const row = rowsOf(body).find((item) => item.name === FILE_NAME
        && (!item.source || item.source === source));
    if (!row?.action_index) return null;
    const detail = await explorerJson(`action/${row.action_index}`);
    return detail?.multipart ? detail : null;
}

async function waitForCompletion(source, issueIndex) {
    const deadline = Date.now() + 900_000;
    let mined = 0;
    let last = null;
    while (Date.now() < deadline) {
        const detail = await manifestDetail(source);
        last = detail?.multipart || last;
        if (detail?.multipart?.status === 'complete') {
            await assertNoArtworkLink(source, issueIndex);
            return detail;
        }
        if (detail?.multipart) expect(detail.multipart.status).toBe('pending');
        await assertNoArtworkLink(source, issueIndex);
        if (mined < MAX_MINED_BLOCKS) {
            await sleep(4_000);
            await minerRpc('generate_blocks', { count: 1 });
            mined += 1;
        } else {
            await sleep(2_000);
        }
    }
    throw new Error(`multipart artwork did not complete after ${mined} mined blocks: ${JSON.stringify(last)}`);
}

async function approveUpload(page, source, issueIndex) {
    await expectConfirmModal(page, 'the multipart artwork upload', 300_000);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 300_000 });
    await page.getByTestId('confirm-approve').click();
    await assertNoArtworkLink(source, issueIndex);
    return waitForCompletion(source, issueIndex);
}

async function approveLink(page, source, issueIndex, manifestIndex) {
    const main = page.getByRole('main');
    const linkButton = main.getByRole('button', { name: `Link artwork to ${TICK}`, exact: true });
    await expect(linkButton).toBeVisible({ timeout: 300_000 });
    await fillUnlock(main);
    await linkButton.click();
    await expectConfirmModal(page, 'the completed artwork link', 120_000);
    await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('confirm-approve').click();
    const txid = await readLabelledTxid(page, 'Artwork attached', 'Link transaction');
    await waitForValidAction(txid);
    const linked = (await artworkLinks(source, issueIndex)).find((row) => row.tx_hash === txid);
    expect(linked, 'the LINK transaction is absent from the source address').toBeTruthy();
    expect(String(linked.coin1_action_index)).toBe(manifestIndex);
    expect(String(linked.coin2_action_index)).toBe(issueIndex);
}

async function assertTokenPageRaw(page, manifestIndex, sourceHash) {
    const rawPath = `/${REGTEST_COIN}/api/file/${manifestIndex}/raw`;
    const responsePromise = page.waitForResponse((response) => {
        return new URL(response.url()).pathname.endsWith(rawPath);
    }, { timeout: 300_000 });
    await openPaletteCommand(page, 'My tokens');
    const main = page.getByRole('main');
    const search = main.getByLabel('Search your tokens by ticker or description');
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill(TICK);
    const row = main.getByRole('button', { name: `Open ${TICK} token details`, exact: true }).first();
    await expect(row).toBeVisible({ timeout: 120_000 });
    await row.click();
    await expect(main.getByRole('heading', { name: TICK, exact: true })).toBeVisible({ timeout: 60_000 });
    const response = await responsePromise;
    expect(response.ok(), `token artwork raw endpoint returned ${response.status()}`).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    expect(sha256(await response.body())).toBe(sourceHash);
}

async function attachMultipartArtwork({ page }) {
    const bytes = randomBytes(FILE_BYTES);
    const sourceHash = sha256(bytes);
    const { source, issueIndex } = await prepareWallet(page);
    await reviewArtwork(page, bytes);
    const manifest = await approveUpload(page, source, issueIndex);
    expect(Number(manifest.multipart.total_parts)).toBe(EXPECTED_PARTS);
    expect(manifest.multipart.status).toBe('complete');
    const manifestIndex = String(manifest.action_index);
    await approveLink(page, source, issueIndex, manifestIndex);
    await assertTokenPageRaw(page, manifestIndex, sourceHash);
}

test.describe(`multipart artwork attachment on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_600_000);
    test('waits for all 26 parts before linking the byte-identical artwork', attachMultipartArtwork);
});
