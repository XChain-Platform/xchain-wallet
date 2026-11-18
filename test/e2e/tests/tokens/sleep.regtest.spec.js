// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SLEEP (PC-05), both formats, signed in the wallet UI and checked against
// the chain's own SLEEP rows on the explorer, not the wallet's success copy.
//
// v1 pauses and resumes a token from Manage Token (shared confirm screen).
// v0 locks the signing address from All actions (legacy review stage with
// a typed LOCK confirm); it runs last because a slept address cannot sign.

import {
    clickManageTokenAction,
    openFromSection,
    createWallet,
    expect,
    openPaletteCommand,
    test,
} from '../../fixtures/wallet.js';
import {
    explorerJson,
    expectConfirmModal,
    fundAddress,
    issuePlainToken,
    readIssueSource,
    mintXchain,
    REGTEST_ADDRESS_RE,
    REGTEST_CHAIN_LABEL,
    switchToRegtest,
    unlockAfterReload,
    waitForTokenBalance,
    waitForValidAction,
    approveConfirm,
} from '../../fixtures/regtest.js';
import { fieldByLabel } from '../../fixtures/fields.js';

const PASSWORD = 'regtestpassword123';
const FUNDING = 1;
const SUPPLY = '1000';
const STAMP = Date.now().toString().slice(-6);
// A prefix of its own, so this spec's rows stand apart on a shared venue.
const TICK = `SLW${STAMP}`;
/** Pays the ISSUE fee and the three SLEEP fees in XCHAIN, with room to spare. */
const MINT_XCHAIN = 20;
/** How far past the tip the address lock resumes, beyond anything a nudge mines mid-test. */
const LOCK_AHEAD_BLOCKS = 1000;

/** Approves the open confirm screen and returns the broadcast txid. */
async function approveAndGetTxid(page) {
    await approveConfirm(page);
    const main = page.getByRole('main');
    await expect(main, 'no transaction id ever appeared after Approve')
        .toContainText(/[0-9a-f]{64}/, { timeout: 180_000 });
    const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
    expect(txid, 'success screen showed no transaction id').toBeTruthy();
    return txid;
}

/** Opens Manage Token for `tick` and clicks the pause/resume action (label varies with state). */
async function openPauseAction(page, tick, label) {
    await openPaletteCommand(page, 'My tokens');
    const main = page.getByRole('main');
    const row = main.getByRole('button').filter({ hasText: tick }).first();
    await expect(row, `${tick} is on chain but My Tokens does not list it`)
        .toBeVisible({ timeout: 60_000 });
    await row.click();
    // G12: My Tokens opens the shared token page, titled with the token's
    // name (no "Manage Token" heading); the issuer's action row is what to
    // wait for, and clickManageTokenAction waits for it.
    await clickManageTokenAction(main, label);
}

/** Opens the address self-lock form (SLEEP v0) off the All actions page. */
async function openLockAddress(page) {
    await openPaletteCommand(page, 'All actions');
    const entry = page.getByRole('main').getByRole('button', { name: /^Lock this address/ });
    await expect(entry, 'All actions has no "Lock this address" entry').toBeVisible({ timeout: 30_000 });
    await entry.click();
    // The address being locked is the form's From address, inside the From
    // section, which the form keeps closed until opened.
    const main = page.getByRole('main');
    await expect(main.getByRole('form', { name: 'Lock address' })).toBeVisible({ timeout: 30_000 });
    await openFromSection(main);
    await expect(fieldByLabel(main, 'Address to lock')).toBeVisible({ timeout: 30_000 });
}

/**
 * The lock form shows no status line: an awake address leaves Lock address
 * enabled once the chain state is read, with no "is locked" line.
 */
async function expectAddressAwake(page) {
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: /^Lock address$/i }),
        'the lock form never enabled Lock address for an address the chain has awake')
        .toBeEnabled({ timeout: 30_000 });
    await expect(main.getByText(/^This address is locked /),
        'the lock form reads an awake address as locked').toHaveCount(0);
}

/**
 * A locked address gets one plain line naming its wake block, and Lock
 * address stays disabled, since a locked address cannot lock again.
 */
async function expectAddressLockedUntil(page, resumeBlock) {
    const main = page.getByRole('main');
    await expect(main.getByText(
        `This address is locked until block ${String(resumeBlock)}.`, { exact: false }),
    'the lock form does not read the lock the chain has').toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole('button', { name: /^Lock address$/i })).toBeDisabled();
}

/** The latest valid SLEEP row for `tick`, straight off the explorer. */
async function latestSleepRow(tick) {
    const resp = await explorerJson(`sleeps/${tick}/token`);
    const rows = (Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [])
        .filter((r) => String(r.status || 'valid') === 'valid');
    expect(rows.length, `the explorer has no SLEEP rows at all for ${tick} yet`).toBeGreaterThan(0);
    rows.sort((a, b) => Number(b.action_index ?? 0) - Number(a.action_index ?? 0));
    return rows[0];
}

test.describe(`SLEEP (tick pause/resume and address lock) on ${REGTEST_CHAIN_LABEL}`, () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(1_800_000);

    test('pausing a token, resuming it and locking the address all land on chain', async ({ page }) => {
        let source;

        await test.step('onboard, fund and issue a token', async () => {
            await createWallet(page, { password: PASSWORD, name: 'Sleep Wallet' });
            await switchToRegtest(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            const main = page.getByRole('main');
            await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
            source = await readIssueSource(main);
            expect(source, `the form has no ${REGTEST_CHAIN_LABEL} address to sign with`)
                .toMatch(REGTEST_ADDRESS_RE);
            await fundAddress(source, FUNDING);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);
            // ISSUE and SLEEP charge an XCHAIN protocol fee, and the preflight
            // disables Approve on a wallet that holds none.
            await mintXchain(page, MINT_XCHAIN);
            await waitForTokenBalance(source, 'XCHAIN', MINT_XCHAIN);
            await page.reload();
            await unlockAfterReload(page, PASSWORD);

            await openPaletteCommand(page, 'Issue token');
            await expect(fieldByLabel(main, 'Ticker')).toBeVisible({ timeout: 30_000 });
            await readIssueSource(main);
            await issuePlainToken(main, { ticker: TICK, supply: SUPPLY, password: PASSWORD });

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);
        });

        await test.step('pause the token indefinitely', async () => {
            await openPauseAction(page, TICK, 'Pause token');
            const main = page.getByRole('main');
            // The pause setting is a themed dropdown, not a radio group.
            await expect(main.getByRole('button', { name: /^Pause setting/ }))
                .toBeVisible({ timeout: 30_000 });
            await main.getByRole('button', { name: /^Pause setting/ }).click();
            await page.getByRole('option', { name: /Pause indefinitely/ }).click();
            // The submit reads "Pause Token" (title case), the action row "Pause token".
            await main.getByRole('button', { name: /^Pause token$/i }).click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);

            const row = await latestSleepRow(TICK);
            expect(String(row.resume_block ?? row.resumeBlock),
                `the chain's newest SLEEP row for ${TICK} does not read as an indefinite pause `
                + '(RESUME_BLOCK -1)')
                .toBe('-1');
            expect(row.tx_hash).toBe(txid);
        });

        await test.step('a paused token does not read as a locked address', async () => {
            // `/sleeps/{address}/address` lists every SLEEP the address signed,
            // tick pauses included; the lock form must not read the tick pause
            // above as a lock on the owner's own address.
            await openLockAddress(page);
            await expect(fieldByLabel(page, 'Address to lock')).toHaveValue(source);
            await expectAddressAwake(page);
        });

        await test.step('resume the token', async () => {
            await openPauseAction(page, TICK, 'Resume token');
            const main = page.getByRole('main');
            // A paused token offers only Resume: the form has no pause
            // setting to pick, and its main action reads Resume token.
            // Submits are title case ("Resume Token"); the action row is not.
            const resume = main.getByRole('button', { name: /^Resume token$/i });
            await expect(resume, 'a paused token\'s form does not offer Resume token').toBeEnabled({ timeout: 30_000 });
            await expect(main.getByRole('button', { name: /^Pause setting/ })).toHaveCount(0);
            await resume.click();

            await expectConfirmModal(page, 'this action', 60_000);
            await expect(page.getByTestId('confirm-approve')).toBeEnabled({ timeout: 120_000 });
            const txid = await approveAndGetTxid(page);
            await waitForValidAction(txid);

            const row = await latestSleepRow(TICK);
            expect(String(row.resume_block ?? row.resumeBlock),
                `the chain's newest SLEEP row for ${TICK} does not read as resumed (RESUME_BLOCK 0)`)
                .toBe('0');
            expect(row.tx_hash).toBe(txid);
        });

        await test.step('lock the signing address until a block (SLEEP v0)', async () => {
            await openLockAddress(page);
            const main = page.getByRole('main');
            await expect(fieldByLabel(main, 'Address to lock'),
                'the lock form offers a different address than the one that signed the rest of this test')
                .toHaveValue(source);
            await expectAddressAwake(page);

            await main.getByRole('slider', { name: 'Duration' }).fill('4');
            await fieldByLabel(main, 'Blocks').fill(String(LOCK_AHEAD_BLOCKS));
            await main.getByRole('button', { name: /^Lock address$/i }).click();

            // The form no longer shows an end line; the review's wake condition names the block.
            const wakeLine = main.getByText(/Automatically at block [\d,]+/);
            await expect(wakeLine, 'the lock review never showed its wake block').toBeVisible({ timeout: 30_000 });
            const resumeBlock = Number((await wakeLine.first().innerText()).match(/at block ([\d,]+)/)?.[1]?.replace(/,/g, ''));
            expect(Number.isFinite(resumeBlock) && resumeBlock > 0, 'unreadable wake block on the lock review').toBe(true);

            // Legacy review stage: irreversibility warning, typed confirm, sign.
            await expect(page.getByTestId('confirm-action-warnings'))
                .toContainText("While locked, this address can't create any XChain action", { timeout: 30_000 });
            const sign = main.getByRole('button', { name: /^Lock address$/i });
            await expect(sign, 'Sign is live before LOCK was typed').toBeDisabled();
            const password = fieldByLabel(main, 'Password');
            if (await password.count() > 0 && await password.isVisible()) await password.fill(PASSWORD);
            await fieldByLabel(main, 'Type LOCK to confirm').fill('LOCK');
            await expect(sign).toBeEnabled({ timeout: 15_000 });
            await sign.click();

            await expect(main.getByText('Lock address broadcast'), 'the lock never reported a broadcast')
                .toBeVisible({ timeout: 180_000 });
            const txid = (await main.innerText()).match(/[0-9a-f]{64}/)?.[0];
            expect(txid, 'the lock success screen showed no transaction id').toBeTruthy();
            await waitForValidAction(txid);

            const resp = await explorerJson(`sleeps/${source}/address`);
            const rows = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];
            const row = rows.find((r) => r.tx_hash === txid);
            expect(row, `the explorer lists no SLEEP row for the lock ${txid}`).toBeTruthy();
            expect(String(row.status || 'valid')).toBe('valid');
            expect(Number(row.action_format), 'the lock was not composed as SLEEP v0').toBe(0);
            expect(row.tick ?? null, 'an address lock carries no TICK').toBeNull();
            expect(String(row.resume_block ?? row.resumeBlock),
                'the chain did not record the resume block the form was given').toBe(String(resumeBlock));
            expect(row.source).toBe(source);

            // Back to the form: it now reads the lock off the chain.
            await openLockAddress(page);
            await expectAddressLockedUntil(page, resumeBlock);
        });
    });
});
