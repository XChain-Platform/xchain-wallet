// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createWallet, openSettings } from '../../fixtures/wallet.js';
import { expect, test } from '../../fixtures/extension-isolated.js';

const PASSWORD = 'extensionapproval123';
const DAPP_ORIGIN = 'http://127.0.0.1:41739';
const DAPP_NAME = 'Local approval test';
const CHAIN_ID = 'bitcoin-mainnet';

const DAPP_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${DAPP_NAME}</title></head>
<body>
    <h1>${DAPP_NAME}</h1>
    <button id="connect" type="button">Connect wallet</button>
    <button id="sign" type="button" disabled>Sign message</button>
    <output id="result" aria-live="polite"></output>
    <script>
        const result = document.querySelector('#result');
        const sign = document.querySelector('#sign');

        document.querySelector('#connect').addEventListener('click', async () => {
            window.connectResult = null;
            window.connectResult = await window.xchain.connect({
                appName: '${DAPP_NAME}',
                requestedChains: ['${CHAIN_ID}'],
            });
            result.textContent = JSON.stringify(window.connectResult);
            sign.disabled = !window.connectResult.ok;
        });

        sign.addEventListener('click', async () => {
            window.signResult = null;
            const addresses = await window.xchain.getAddresses('${CHAIN_ID}');
            window.signResult = await window.xchain.signMessage({
                chainId: '${CHAIN_ID}',
                address: addresses[0].address,
                message: 'Approve this local extension test message.',
            });
            result.textContent = JSON.stringify(window.signResult);
        });
    </script>
</body>
</html>`;

async function waitForApprovalPage(context, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    for (;;) {
        const approval = context.pages().find((candidate) => candidate.url().includes('approval.html'));
        if (approval) {
            await approval.waitForLoadState('domcontentloaded').catch(() => {});
            return approval;
        }
        if (Date.now() > deadline) throw new Error(`no approval window appeared within ${timeout}ms`);
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}

async function expectSafeInitialFocus(approval) {
    const reject = approval.getByRole('button', { name: 'Reject', exact: true });
    await expect(reject).toBeVisible({ timeout: 20_000 });
    await expect(reject, 'approval did not put keyboard focus on the safe decision')
        .toBeFocused({ timeout: 20_000 });
}

async function escapeApproval(approval) {
    const closed = approval.waitForEvent('close');
    // The window closes on keydown, so the keyup half of press() can land
    // on a closed page; that is the expected outcome, not a failure.
    try {
        await approval.keyboard.press('Escape');
    } catch (error) {
        if (!/closed/i.test(String(error?.message))) throw error;
    }
    await closed;
}

async function clickAndLetApprovalClose(locator, approval) {
    const closed = approval.waitForEvent('close');
    try {
        await locator.click({ noWaitAfter: true });
    } catch (error) {
        if (!/closed/i.test(String(error?.message))) throw error;
    }
    await closed;
}

async function openConnectedSites(page) {
    await openSettings(page);
    const row = page.getByRole('main').getByRole('button', { name: /^Connected sites/ }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByLabel('Origin or wildcard to block')).toBeVisible({ timeout: 30_000 });
}

test.describe('Injected-provider approvals and connected sites', () => {
    test.use({ actionTimeout: 30_000 });

    test('keeps rejection keyboard-safe and revokes an approved local site', async ({ context, page }) => {
        await createWallet(page, { password: PASSWORD, name: 'Extension approval wallet', navigate: false });

        const dapp = await context.newPage();
        await dapp.route(`${DAPP_ORIGIN}/**`, (route) => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: DAPP_HTML,
        }));
        await dapp.goto(`${DAPP_ORIGIN}/`);
        await expect.poll(
            () => dapp.evaluate(() => Boolean(window.xchain)),
            { timeout: 30_000, message: 'the extension did not inject window.xchain into the local page' },
        ).toBe(true);

        await dapp.getByRole('button', { name: 'Connect wallet' }).click();
        const rejectedConnect = await waitForApprovalPage(context);
        await expectSafeInitialFocus(rejectedConnect);
        await escapeApproval(rejectedConnect);
        await expect.poll(() => dapp.evaluate(() => window.connectResult))
            .toMatchObject({ ok: false, error: 'USER_REJECTED' });

        await dapp.getByRole('button', { name: 'Connect wallet' }).click();
        const approvedConnect = await waitForApprovalPage(context);
        await expectSafeInitialFocus(approvedConnect);
        const connect = approvedConnect.getByRole('button', { name: 'Connect', exact: true });
        await expect(connect).toBeEnabled({ timeout: 20_000 });
        await clickAndLetApprovalClose(connect, approvedConnect);
        await expect.poll(() => dapp.evaluate(() => window.connectResult))
            .toMatchObject({ ok: true });

        await dapp.getByRole('button', { name: 'Sign message' }).click();
        const signApproval = await waitForApprovalPage(context);
        await expect(signApproval.getByText('Sign message', { exact: true }).first())
            .toBeVisible({ timeout: 20_000 });
        await expectSafeInitialFocus(signApproval);
        await escapeApproval(signApproval);
        await expect.poll(() => dapp.evaluate(() => window.signResult))
            .toMatchObject({ ok: false, error: 'USER_REJECTED' });

        await openConnectedSites(page);
        const main = page.getByRole('main');
        await expect(main.getByText(DAPP_NAME, { exact: true })).toBeVisible();
        await expect(main.getByText(DAPP_ORIGIN, { exact: true })).toBeVisible();

        await main.getByRole('button', { name: 'Disconnect', exact: true }).click();
        const confirm = page.getByRole('dialog', { name: `Disconnect ${DAPP_NAME}?` });
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Disconnect site', exact: true }).click();
        await expect(main.getByText(DAPP_ORIGIN, { exact: true })).toHaveCount(0);
        await expect(main.getByText('No sites connected yet', { exact: true })).toBeVisible();

        const accessAfterRevoke = await dapp.evaluate(() => window.xchain.getAccounts().then(
            () => ({ allowed: true }),
            (error) => ({ allowed: false, code: error?.code }),
        ));
        expect(accessAfterRevoke).toEqual({ allowed: false, code: 'NOT_CONNECTED' });
    });
});
