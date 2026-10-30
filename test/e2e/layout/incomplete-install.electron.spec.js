// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A desktop profile holding meta.json and no vault.bin, the state a reset
// leaves when it stops between the two deletes. The app opens on the
// incomplete-wallet screen, and its Reset this wallet clears the meta and
// lands on onboarding, where a new wallet can be created.
//
// XCHAIN_E2E_PROFILE_ROOT picks where the throwaway profile goes; the
// system temp directory is the default.

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { makeFreshKdfParams } from '../../../packages/core/src/crypto/kdf.js';
import en from '../../../packages/core/src/i18n/locales/en/errors.js';
import onboardingEn from '../../../packages/core/src/i18n/locales/en/onboarding.js';
import { LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, dismissIntroCarousel } from '../fixtures/wallet.js';
import { closeElectron, launchGuardedElectron, readNetworkGuard } from '../fixtures/electron.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const desktopDir = join(repo, 'packages', 'desktop');
const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));

test('meta without a vault opens the incomplete-wallet screen, and its reset reaches onboarding', async () => {
    test.setTimeout(3 * 60 * 1000);
    const profile = mkdtempSync(join(process.env.XCHAIN_E2E_PROFILE_ROOT || tmpdir(), 'xc-incomplete-'));
    writeFileSync(join(profile, 'meta.json'), JSON.stringify({ kdfParams: makeFreshKdfParams() }), { mode: 0o600 });
    expect(existsSync(join(profile, 'vault.bin'))).toBe(false);

    const app = await launchGuardedElectron(electron, {
        executablePath: requireFromDesktop('electron'),
        args: ['.', `--user-data-dir=${profile}`, '--use-mock-keychain'],
        cwd: desktopDir,
    });
    try {
        const win = await app.firstWindow();
        await win.addInitScript(([atKey, versionKey, version]) => {
            window.localStorage.setItem(atKey, new Date().toISOString());
            window.localStorage.setItem(versionKey, version);
        }, [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION]);
        await win.reload();

        await expect(win.getByRole('heading', { name: en['vaultUnavailable.incomplete.title'] }))
            .toBeVisible({ timeout: 60_000 });
        await expect(win.getByText(en['vaultUnavailable.incomplete.body'])).toBeVisible();
        await expect(win.getByRole('button', { name: onboardingEn['onboarding.createNewWallet'] })).toHaveCount(0);

        await win.getByRole('button', { name: en['vaultUnavailable.incomplete.reset'] }).click();
        await win.getByLabel(en['vaultUnavailable.wipeConfirm']).fill('WIPE');
        await win.getByRole('button', { name: en['vaultUnavailable.incomplete.reset'] }).click();

        await expect(win.getByRole('heading', { name: en['vaultUnavailable.incomplete.title'] }))
            .toHaveCount(0, { timeout: 30_000 });
        await expect.poll(() => existsSync(join(profile, 'meta.json'))).toBe(false);
        await dismissIntroCarousel(win);
        await expect(win.getByRole('button', { name: onboardingEn['onboarding.createNewWallet'] }))
            .toBeVisible({ timeout: 30_000 });

        const guard = await readNetworkGuard(app);
        expect(guard.refusals, 'no request left the machine').toEqual([]);
    } finally {
        await closeElectron(app);
    }
});
