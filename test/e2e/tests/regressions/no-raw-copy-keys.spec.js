// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy loads by namespace: first paint carries the startup files and
// each later screen brings its own with its chunk. A screen that renders a key
// whose namespace has not loaded shows the raw key (`settings.backup.title`)
// instead of its copy, so this walk reads every screen's text and accessible
// names and fails on any string that is a dictionary key.

import { en } from '../../../../packages/core/src/i18n/locales/en/index.js';
import {
    createWallet,
    expect,
    gotoSection,
    lockButton,
    nav,
    openPaletteCommand,
    test,
    unlockedShell,
} from '../../fixtures/wallet.js';

const KEYS = new Set(Object.keys(en));

async function rawKeysOnScreen(page) {
    const strings = await page.evaluate(() => {
        const out = [document.body.innerText];
        for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
            for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
                const value = el.getAttribute(attr);
                if (value) out.push(value);
            }
        }
        return out;
    });
    const found = new Set();
    for (const text of strings) {
        for (const token of text.split(/[\s()[\]{}"',:;!?]+/)) {
            const bare = token.replace(/\.+$/, '');
            if (KEYS.has(bare)) found.add(bare);
        }
    }
    return [...found].sort();
}

async function expectNoRawKeys(page, screen) {
    // Give a lazy chunk time to land; the check is that its copy came with it.
    await page.waitForLoadState('networkidle').catch(() => {});
    expect(await rawKeysOnScreen(page), `${screen} renders raw copy keys`).toEqual([]);
}

test('first screens and lazy routes render copy, never raw keys', async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/');
    await expect(page.getByRole('button', { name: /Create new wallet|Next|Get started/ }).first()).toBeVisible();
    await expectNoRawKeys(page, 'Onboarding');

    await createWallet(page, { navigate: false });
    await expect(unlockedShell(page)).toBeVisible();
    await expectNoRawKeys(page, 'Home');

    for (const section of ['History', 'Send', 'Receive', 'Contacts', 'Settings']) {
        await gotoSection(page, section);
        await expect(page.getByRole('main')).toBeVisible();
        await expectNoRawKeys(page, section);
    }

    for (const title of ['Addresses', 'Create a token', 'Open DEX']) {
        await openPaletteCommand(page, title);
        await expect(page.getByRole('main')).toBeVisible();
        await expectNoRawKeys(page, title);
    }

    await gotoSection(page, 'Home');
    await expect(nav(page)).toBeVisible();
    await lockButton(page).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expectNoRawKeys(page, 'Locked');
});
