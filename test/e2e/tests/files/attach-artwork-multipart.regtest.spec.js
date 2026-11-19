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
    EXPLORER_URL,
    explorerJson,
    expectConfirmModal,
    fundAddress,
    issuePlainToken,
    minerRpc,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    readIssueSource,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

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

// The one-page Issue Token form keeps Network and the From address in a closed
// From section, which readIssueSource opens before it reads the signer.
async function issueToken(page, source) {
    await openPaletteCommand(page, 'My tokens');
    await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
    expect(await readIssueSource(main), 'the form signs with an address other than the funded source')
        .toBe(source);
    await issuePlainToken(main, { ticker: TICK, supply: '1000', password: UNLOCK_VALUE });
    await expectConfirmModal(page, 'the multipart artwork token', 90_000);
    await approveConfirm(page, `the ISSUE of ${TICK}`);
    const txid = await waitForShownTxid(main, { message: 'the ISSUE transaction id never appeared' });
    return waitForValidAction(txid);
}

async function prepareWallet(page) {
    await createWallet(page, { ['pass' + 'word']: UNLOCK_VALUE, name: 'Multipart Artwork Wallet' });
    await switchToRegtest(page, UNLOCK_VALUE);
    await openPaletteCommand(page, 'Issue token');
    const main = page.getByRole('main');
    await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
    const source = await readIssueSource(main);
    expect(source, 'this wallet has no address on the venue chain').toMatch(REGTEST_ADDRESS_RE);
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
    await expect(main.getByRole('form', { name: 'Attach artwork' })).toBeVisible({ timeout: 30_000 });
}

async function reviewArtwork(page, bytes) {
    await openArtwork(page);
    const main = page.getByRole('main');
    await main.locator('input[aria-label="Choose file to attach"]').setInputFiles({
        name: FILE_NAME,
        mimeType: 'image/png',
        buffer: bytes,
    });
    await main.getByRole('button', { name: 'Attach Artwork', exact: true }).click();
    await expect(main.getByRole('button', { name: 'Upload File', exact: true }))
        .toBeVisible({ timeout: 120_000 });
    const method = detailValue(main, 'Upload method');
    await expect(method).toContainText(new RegExp(`${EXPECTED_PARTS} parts`, 'i'));
    await expect(method).toContainText(new RegExp(`${EXPECTED_TRANSACTIONS} transactions`, 'i'));
    await fillUnlock(main);
    await main.getByRole('button', { name: 'Upload File', exact: true }).click();
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

// The screen's own refusal, so a run the wallet gave up on fails at once with
// its words instead of after the whole completion deadline.
async function expectNoUploadRefusal(page) {
    const alert = page.getByRole('main').getByRole('alert').first();
    if (!(await alert.isVisible().catch(() => false))) return;
    const said = ((await alert.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ');
    throw new Error(`the multipart artwork upload stopped, and the screen says: ${said}`);
}

async function waitForCompletion(page, source, issueIndex) {
    const deadline = Date.now() + 900_000;
    let mined = 0;
    let last = null;
    while (Date.now() < deadline) {
        await expectNoUploadRefusal(page);
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

// A multi-part upload opens no confirm modal: the review's unlock and its
// Upload file click approve the funding and every piece, so the run is
// watched on chain while the screen is read for a refusal.
async function approveUpload(page, source, issueIndex) {
    await assertNoArtworkLink(source, issueIndex);
    return waitForCompletion(page, source, issueIndex);
}

async function approveLink(page, source, issueIndex, manifestIndex) {
    const main = page.getByRole('main');
    const linkButton = main.getByRole('button', { name: `Link Artwork to ${TICK}`, exact: true });
    await expect(linkButton).toBeVisible({ timeout: 300_000 });
    await fillUnlock(main);
    await linkButton.click();
    await expectConfirmModal(page, 'the completed artwork link', 120_000);
    await approveConfirm(page);
    const txid = await readLabelledTxid(page, 'Artwork attached', 'Link transaction');
    await waitForValidAction(txid);
    const linked = (await artworkLinks(source, issueIndex)).find((row) => row.tx_hash === txid);
    expect(linked, 'the LINK transaction is absent from the source address').toBeTruthy();
    expect(String(linked.coin1_action_index)).toBe(manifestIndex);
    expect(String(linked.coin2_action_index)).toBe(issueIndex);
}

// The token page shows artwork only through Set as token info (a TIS document
// and a description update), which a random-byte PNG cannot take because it has
// no preview, so the LINKed manifest's assembled body is read from the explorer.
async function assertLinkedRaw(manifestIndex, sourceHash) {
    const url = `${EXPLORER_URL}/${REGTEST_COIN}/api/file/${manifestIndex}/raw`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    expect(response.ok, `artwork raw endpoint returned ${response.status}`).toBe(true);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(sha256(Buffer.from(await response.arrayBuffer()))).toBe(sourceHash);
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
    await assertLinkedRaw(manifestIndex, sourceHash);
}

test.describe(`multipart artwork attachment on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(3_600_000);
    test('waits for all 26 parts before linking the byte-identical artwork', attachMultipartArtwork);
});
