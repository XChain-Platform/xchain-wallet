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

import { createWallet, expect, openPaletteCommand, test } from '../../fixtures/wallet.js';
import {
    EXPLORER_URL,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    REGTEST_COIN,
    approveConfirm,
    explorerJson,
    expectConfirmModal,
    fundAddress,
    minerRpc,
    readReceiveAddress,
    selectVenueChain,
    switchToRegtest,
    unlockAfterReload,
} from '../../fixtures/regtest.js';

const UNLOCK_VALUE = ['multipart', 'waves', 'word123'].join('');
const PART_BYTES = 389_920;
const EXPECTED_PARTS = 101;
const FILE_BYTES = EXPECTED_PARTS * PART_BYTES;
const EXPECTED_TRANSACTIONS = 206;
const MAX_MINED_BLOCKS = 150;
const STAMP = Date.now().toString().slice(-8);
const FILE_NAME = `multipart-waves-${STAMP}.bin`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test.skip(REGTEST_COIN !== 'RBTC', 'the 389,920-byte Taproot parts require Bitcoin');

function rowsOf(body) {
    if (Array.isArray(body?.data)) return body.data;
    return Array.isArray(body) ? body : [];
}

async function manifestDetail(source) {
    const body = await explorerJson(`files/${encodeURIComponent(FILE_NAME)}/name`);
    const row = rowsOf(body).find((item) => item.name === FILE_NAME
        && (!item.source || item.source === source));
    if (!row?.action_index) return null;
    const detail = await explorerJson(`action/${row.action_index}`);
    return detail?.multipart ? detail : null;
}

async function startProgressCapture(page) {
    await page.evaluate(() => {
        globalThis.__multipartWaveProgress = [];
        const collect = () => {
            for (const heading of document.querySelectorAll('h2')) {
                const match = heading.textContent?.match(/^Uploading part (\d+) of 101$/);
                if (match) globalThis.__multipartWaveProgress.push(Number(match[1]));
            }
        };
        collect();
        globalThis.__multipartWaveObserver = new MutationObserver(collect);
        globalThis.__multipartWaveObserver.observe(document.body, {
            childList: true,
            characterData: true,
            subtree: true,
        });
    });
}

async function capturedProgress(page) {
    return page.evaluate(() => Math.max(0, ...(globalThis.__multipartWaveProgress || [])));
}

async function expectNoSecondApproval(page) {
    await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Approve\b/ })).toHaveCount(0);
}

async function waitForCompleteManifest(page, source) {
    const deadline = Date.now() + 5_400_000;
    let mined = 0;
    let last = null;
    while (Date.now() < deadline) {
        await expectNoSecondApproval(page);
        const detail = await manifestDetail(source);
        last = detail?.multipart || last;
        if (detail?.multipart?.status === 'complete') {
            expect(await capturedProgress(page), 'the upload panel never advanced beyond part 100')
                .toBeGreaterThan(100);
            return detail;
        }
        if (detail?.multipart) expect(detail.multipart.status).toBe('pending');
        if (mined < MAX_MINED_BLOCKS) {
            await sleep(4_000);
            await minerRpc('generate_blocks', { count: 1 });
            mined += 1;
        } else {
            await sleep(2_000);
        }
    }
    throw new Error(
        `multipart file did not complete after ${mined} mined blocks; `
        + `progress=${await capturedProgress(page)} manifest=${JSON.stringify(last)}`,
    );
}

async function assertRawFile(manifestIndex, sourceHash) {
    const url = `${EXPLORER_URL}/${REGTEST_COIN}/api/file/${manifestIndex}/raw`;
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    expect(response.ok, `multipart raw endpoint returned ${response.status}`).toBe(true);
    expect(response.headers.get('content-type')).toContain('application/octet-stream');
    expect(sha256(Buffer.from(await response.arrayBuffer()))).toBe(sourceHash);
}

test.describe(`Publish a multipart file in funding waves on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 60_000 });
    test.setTimeout(7_200_000);

    test('publishes 101 Taproot parts across two waves with one approval', async ({ page }) => {
        const bytes = randomBytes(FILE_BYTES);
        const sourceHash = sha256(bytes);
        let source;

        await test.step('onboard and fund the publisher', async () => {
            await createWallet(page, { password: UNLOCK_VALUE, name: 'Multipart Waves Wallet' });
            await switchToRegtest(page, UNLOCK_VALUE);
            source = await readReceiveAddress(page);
            expect(source).toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, 5);
            await page.reload();
            await unlockAfterReload(page, UNLOCK_VALUE);
        });

        const main = page.getByRole('main');
        await test.step('review all parts, transactions, and the single fee', async () => {
            await openPaletteCommand(page, 'Publish file');
            await expect(main.getByRole('radiogroup', { name: 'Publish as' }))
                .toBeVisible({ timeout: 30_000 });
            await main.getByRole('radio', { name: /Public/ }).check();
            await selectVenueChain(main, 'Network');
            await main.getByLabel(/^File \(up to /).setInputFiles({
                name: FILE_NAME,
                mimeType: 'application/octet-stream',
                buffer: bytes,
            });
            await expect(main).toContainText(`${FILE_BYTES.toLocaleString('en-US')} bytes`);
            await main.getByRole('checkbox', { name: /on-chain forever/ }).check();

            const method = main.getByRole('button', { name: /^Upload method:/ });
            await expect(method).toContainText(
                `${EXPECTED_PARTS} parts, ${EXPECTED_TRANSACTIONS} transactions`,
                { timeout: 300_000 },
            );
            await expect(method.locator('[data-upload-fee]')).toHaveCount(1);
            await expect(method.locator('[data-upload-fee]')).toContainText(/Network fee about [\d.]+ BTC/);
        });

        let manifest;
        await test.step('approve once and mine both waves through assembly', async () => {
            await startProgressCapture(page);
            await main.getByRole('button', { name: 'Publish file', exact: true }).click();
            await expectConfirmModal(page, 'the 101-part multipart upload', 300_000);
            await approveConfirm(page, 'the 101-part multipart upload', 300_000);
            manifest = await waitForCompleteManifest(page, source);
            expect(Number(manifest.multipart.total_parts)).toBe(EXPECTED_PARTS);
            expect(manifest.multipart.status).toBe('complete');
        });

        await test.step('the assembled raw route is byte-identical', async () => {
            await assertRawFile(String(manifest.action_index), sourceHash);
        });
    });
});
