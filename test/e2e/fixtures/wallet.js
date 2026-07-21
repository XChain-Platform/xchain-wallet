// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared E2E fixture: the one place that knows how to get from a cold
// browser to an unlocked Home.
//
// Every spec used to inline its own copy of that walk. When onboarding
// grew three new screens (license gate, recovery-phrase verification,
// ADS consent), all 15 specs broke at once and each would have needed
// the same edit. Onboarding is the wallet's most-changed surface, so
// the walk belongs behind one seam.
//
// LICENSE GATE: bypassed by seeding the same localStorage keys the app
// reads (Onboarding.jsx), because the gate is NOT what most specs are
// testing and clicking through it would re-couple every spec to legal
// copy that changes for legal reasons. The version is imported from the
// app's own `buildInfo.js`, not hardcoded: the gate re-fires on a
// version mismatch, so a hardcoded '2' here would silently resurrect
// the gate (and re-break every spec) the next time the terms change.
// `license-gate.spec.js` opts out via `test.use({ acceptLicense: false })`
// and drives the real gate, so it stays covered by exactly one spec.

import { test as base, expect } from '@playwright/test';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

export const LICENSE_ACCEPTED_AT_KEY = 'xc:licenseAcceptedAt';
export const LICENSE_ACCEPTED_VERSION_KEY = 'xc:licenseAcceptedVersion';

export const DEFAULT_PASSWORD = 'e2epassword1234';

export const test = base.extend({
    // Set `test.use({ acceptLicense: false })` in a spec that wants to
    // drive the license gate itself.
    acceptLicense: [true, { option: true }],

    page: async ({ page, acceptLicense }, use) => {
        if (acceptLicense) {
            await page.addInitScript(
                ([atKey, versionKey, version]) => {
                    try {
                        window.localStorage.setItem(atKey, new Date().toISOString());
                        window.localStorage.setItem(versionKey, version);
                    } catch {
                        // Storage unavailable: the gate renders and the spec
                        // fails loudly rather than silently testing the gate.
                    }
                },
                [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
            );
        }
        await use(page);
    },
});

export { expect };

// The unlocked shell repeats action names across surfaces: "Send" is the
// nav rail item, a Home quick-action, AND the send form's submit button,
// so a bare getByRole('button', { name: 'Send' }) resolves to three
// elements and trips strict mode. Always say WHICH surface you mean.

/** The nav rail ("Primary navigation"). */
export function nav(page) {
    return page.getByRole('navigation', { name: 'Primary navigation' });
}

/** Clicks a section in the nav rail (Send / History / DEX / ...). */
export async function gotoSection(page, name) {
    await nav(page).getByRole('button', { name, exact: true }).click();
}

/** A button inside the main content region, e.g. a form's submit. */
export function mainButton(page, name) {
    return page.getByRole('main').getByRole('button', { name, exact: true });
}

/**
 * The nav rail's "Lock" button. The header also carries a "Lock wallet"
 * button, so a substring match on "Lock" resolves to two elements and
 * trips strict mode. Anchor on the exact accessible name.
 */
export function lockButton(page) {
    return page.getByRole('button', { name: 'Lock', exact: true });
}

/** Reads the 12/24 recovery words off the mnemonic display stage, in order. */
export async function readRecoveryPhrase(page) {
    const items = await page
        .getByRole('list', { name: 'Recovery phrase' })
        .getByRole('listitem')
        .allInnerTexts();
    // Each item renders as "<position>\n<word>"; the word is the last token.
    return items.map((text) => text.trim().split(/\s+/).pop());
}

/**
 * Fills the recovery-phrase verification challenge. The app asks for a
 * random subset of positions, so probe for whichever "Word N" boxes it
 * rendered rather than assuming which three it picked.
 */
export async function completeRecoveryPhraseChallenge(page, words) {
    await expect(
        page.getByRole('heading', { name: 'Verify your recovery phrase' }),
    ).toBeVisible();

    let filled = 0;
    for (let position = 1; position <= words.length; position += 1) {
        const box = page.getByRole('textbox', { name: `Word ${position}`, exact: true });
        if (await box.count()) {
            await box.fill(words[position - 1]);
            filled += 1;
        }
    }
    // If the challenge stops rendering "Word N" boxes, filling nothing would
    // otherwise look like a pass until the Create click failed 90s later.
    expect(filled, 'recovery-phrase challenge rendered no "Word N" inputs').toBeGreaterThan(0);
}

/**
 * Cold browser -> unlocked Home, via the real create-wallet flow.
 *
 * ADS consent is DECLINED by default: an enabled donation adds an extra
 * output to outgoing transactions, which would perturb the amounts and
 * fees the send specs assert on. Pass `ads: 'enable'` to cover the
 * opt-in path.
 *
 * @returns {Promise<string[]>} the generated recovery phrase
 */
export async function createWallet(page, options = {}) {
    const { password = DEFAULT_PASSWORD, name, ads = 'decline' } = options;

    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Create new wallet' }).click();

    if (name) await page.getByLabel('Wallet name').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Next' }).click();

    const words = await readRecoveryPhrase(page);
    await page.getByLabel(/i have written down/i).check();
    await page.getByRole('button', { name: 'Verify recovery phrase' }).click();

    await completeRecoveryPhraseChallenge(page, words);
    await page.getByRole('button', { name: 'Create wallet' }).click();

    await acknowledgeDonationConsent(page, ads);

    // Argon2id runs on the CI runner's CPU; this is the slow step.
    await expect(lockButton(page)).toBeVisible({ timeout: 90_000 });
    return words;
}

/**
 * Dismisses the pre-onboarding intro carousel ("You hold the keys" / Skip /
 * Back / Next) that now sits in FRONT of the welcome screen.
 *
 * This is the same rot that killed the suite before (see the header note): a
 * new onboarding screen lands, the fixture doesn't know about it, and every
 * spec dies identically in `beforeEach` waiting for a button that is one
 * screen away. It went unnoticed this time because the CI `e2e` job has been
 * failing for unrelated billing reasons since 2026-07-16, so nothing ran.
 *
 * Tolerant by design: if the carousel is ever removed, `Skip` simply won't be
 * there and this becomes a no-op rather than a new failure.
 */
export async function dismissIntroCarousel(page) {
    const skip = page.getByRole('button', { name: 'Skip' });
    try {
        await skip.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
        return;                     // no carousel: nothing to dismiss
    }
    await skip.click();
    // The welcome screen is what the caller actually needs.
    await page.getByRole('button', { name: 'Create new wallet' })
        .waitFor({ state: 'visible', timeout: 15_000 });
}

/** Answers the ADS donation-consent screen shown at the end of onboarding. */
export async function acknowledgeDonationConsent(page, choice = 'decline') {
    const button =
        choice === 'enable'
            ? page.getByRole('button', { name: /Enable and continue/i })
            : page.getByRole('button', { name: /Decline/i });
    await button.click();
}

/** The locked screen's submit button. Disabled until a password is typed. */
export function unlockButton(page) {
    return page.getByRole('button', { name: 'Unlock Wallet' });
}

/** Locks an unlocked wallet and waits for the locked screen. */
export async function lockWallet(page) {
    await lockButton(page).click();
    await expect(unlockButton(page)).toBeVisible();
}

/** Unlocks from the locked screen. */
export async function unlockWallet(page, password = DEFAULT_PASSWORD) {
    await page.getByLabel('Password').fill(password);
    await unlockButton(page).click();
    await expect(lockButton(page)).toBeVisible({ timeout: 90_000 });
}

/**
 * Kills CSS transitions/animations before an accessibility scan.
 *
 * axe computes contrast from the CURRENTLY painted colors. Scanning a
 * screen mid-fade reports the blended intermediate color, which is a
 * phantom: it matches no token in the palette and appears/disappears
 * with machine speed. (This bit us: a scan racing the welcome fade-in
 * reported #79879b, a color the settled page never shows.)
 */
export async function freezeMotion(page) {
    await page.addStyleTag({
        content: `*, *::before, *::after {
            transition: none !important;
            animation: none !important;
        }`,
    });
}
