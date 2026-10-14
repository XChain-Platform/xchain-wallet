// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import {
    dismissIntroCarousel,
    gotoSection,
    openSettings,
    unlockedShell,
} from '../fixtures/wallet.js';
import { launchGuardedElectron } from '../fixtures/electron.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const desktopDir = join(repo, 'packages', 'desktop');
const CREDENTIAL_ERROR = /signer|password/i;

async function acceptLicense(page) {
    await page.reload();
    const accept = page.getByRole('button', { name: 'Accept and continue' });
    const onboarding = page.getByRole('button', { name: 'Skip' })
        .or(page.getByRole('button', { name: 'Create new wallet' }));
    await accept.or(onboarding).first().waitFor({ state: 'visible', timeout: 60_000 });
    if (!(await accept.isVisible())) return;

    await page.getByRole('region', { name: 'License terms' })
        .or(page.getByLabel('License terms')).first()
        .evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            element.dispatchEvent(new Event('scroll'));
        });
    await page.getByRole('checkbox').first().check();
    await accept.click();
}

async function switchActiveNetwork(page, network) {
    await page.getByLabel('Active network', { exact: true }).selectOption(network);
    const label = network.charAt(0).toUpperCase() + network.slice(1);
    await expect(page.getByRole('dialog', { name: `Switch to ${label}?` }))
        .toBeVisible();

    const reloaded = page.waitForEvent('domcontentloaded', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Switch network' }).click();
    await reloaded;
    await expect(unlockedShell(page)).toBeVisible({ timeout: 120_000 });
}

async function expectNoCredentialError(page, runtimeErrors) {
    const visibleErrors = await page.getByRole('alert').allTextContents();
    const forbidden = [...runtimeErrors, ...visibleErrors].filter((message) => CREDENTIAL_ERROR.test(message));
    expect(forbidden, 'network switching and Receive must not report a signer or password error').toEqual([]);
}

test('desktop network round trip leaves Receive usable', async () => {
    test.setTimeout(10 * 60 * 1000);
    const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
    const app = await launchGuardedElectron(electron, {
        executablePath: requireFromDesktop('electron'),
        args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'xc-network-switch-'))}`],
        cwd: desktopDir,
    });

    try {
        const page = await app.firstWindow();
        const runtimeErrors = [];
        page.on('pageerror', (error) => runtimeErrors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') runtimeErrors.push(message.text());
        });

        await acceptLicense(page);
        await dismissIntroCarousel(page);
        await page.getByRole('button', { name: 'Try in demo mode' }).click();
        await expect(unlockedShell(page)).toBeVisible({ timeout: 120_000 });

        await openSettings(page);
        await page.getByRole('button', { name: /^Developer mode/ }).click();
        const developerMode = page.getByRole('switch', { name: 'Developer Mode', exact: true });
        if (!(await developerMode.isChecked())) {
            await developerMode.click();
            await expect(developerMode).toBeChecked();
        }
        await page.getByRole('button', { name: 'Back to settings' }).click();

        // The demo may start on either network; go to the other one and back.
        const start = await page.getByLabel('Active network', { exact: true }).inputValue();
        const away = start === 'regtest' ? 'mainnet' : 'regtest';
        await switchActiveNetwork(page, away);
        await expectNoCredentialError(page, runtimeErrors);

        await openSettings(page);
        await expect(page.getByLabel('Active network', { exact: true })).toHaveValue(away);
        await switchActiveNetwork(page, start);
        await expectNoCredentialError(page, runtimeErrors);

        await gotoSection(page, 'Receive');
        // The read-only receive field is named by the address's own label
        // ("BTC Address #1" in the demo wallet), not a fixed "Address".
        const address = page.getByRole('textbox', { name: /address/i }).and(page.locator('input[readonly]'));
        const unlockPrompt = page.getByRole('button', { name: 'Unlock Wallet' });
        await expect(address.or(unlockPrompt).first()).toBeVisible({ timeout: 30_000 });
        if (await address.isVisible()) await expect(address).not.toHaveValue('');
        await expectNoCredentialError(page, runtimeErrors);
    } finally {
        await app.close();
    }
});
