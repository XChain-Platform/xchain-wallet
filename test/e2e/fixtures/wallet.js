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

/**
 * The wallet's navigation surface, whichever one the layout is showing.
 *
 * §5.6 responsive-first : the left rail ("Primary navigation")
 * collapses below 900px and below 600px `<BottomTabBar>` ("Bottom
 * navigation") takes over. The MV3 popup is 400px wide, so it is ALWAYS in
 * the bottom-bar band - a fixture anchored on the rail alone finds nothing
 * there, which is not a wallet defect but a test that only knew one shell.
 *
 * Normally exactly one is in the accessibility tree: the rail is
 * `display:none` below 900px, and the bar only mounts for the JS-gated
 * `small` variant. They CAN coexist - pinning small at a wide window
 * deliberately keeps the bar (LeftNav.module.css:60-67) - and both are
 * genuinely usable then, so take the first rather than trip strict mode on
 * a configuration that is working as designed.
 */
export function nav(page) {
    return page.getByRole('navigation', { name: 'Primary navigation' })
        .or(page.getByRole('navigation', { name: 'Bottom navigation' }))
        .first();
}

/**
 * The unlocked shell's signal that onboarding finished, in ANY shell.
 *
 * Anchored on Home's `<section aria-label="Total balance">` (core's
 * `TotalBalanceHero`, rendered via `HomeTabs` by every shell) rather than on
 * navigation, because the three shells do not agree on navigation at all:
 * web/desktop render the rail or the bottom bar, and the MV3 popup renders
 * NEITHER - it is a route-per-view shell with no shared layout wrapper
 * (`packages/extension/src/popup/App.jsx:600-603` says so explicitly), so no
 * nav landmark exists there to wait on.
 *
 * The nav rail's Lock button is not usable for this either: below 600px it
 * lives inside the More sheet, which is closed by default.
 */
export function unlockedShell(page) {
    return page.getByRole('region', { name: 'Total balance' }).first();
}

/**
 * Opens Settings, by whichever route this shell offers.
 *
 * : the MV3 popup has no navigation surface. Its entry point is the gear
 * in Home's balance hero, which is what a real user has; the command palette
 * also lists every Settings section and is kept here as the fallback so this
 * still works if the gear ever moves. Web and desktop use the nav. Same screen
 * either way, so the walk after this is shared.
 */
export async function openSettings(page) {
    if (await nav(page).count() > 0) {
        await gotoSection(page, 'Settings');
        return;
    }

    const gear = page.getByRole('button', { name: 'Open settings' });
    if (await gear.count() > 0) {
        await gear.click();
    } else {
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await palette.waitFor({ state: 'visible', timeout: 15_000 });
        await palette.getByRole('combobox').fill('settings');
        await palette.getByRole('option', { name: /^Settings/ }).first().click();
    }
    await expect(page.getByRole('button', { name: /^Developer Mode/ }))
        .toBeVisible({ timeout: 15_000 });
}

/**
 * Clicks a section (Send / History / DEX / ...) in whichever nav is showing.
 *
 * The bottom bar surfaces only four primary tabs (Home, History, Send,
 * Scan); everything else lives behind "More". Try the visible nav first and
 * fall back to the sheet, so one call works at every width.
 */
export async function gotoSection(page, name) {
    const bar = nav(page);
    if (await bar.count() > 0) {
        const direct = bar.getByRole('button', { name, exact: true });
        if (await direct.count() > 0) {
            await direct.click();
            return;
        }
        await bar.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('dialog', { name: 'More navigation' })
            .getByRole('button', { name, exact: true })
            .click();
        return;
    }

    // No nav landmark at all: the MV3 popup. It navigates from Home's quick
    // actions (Send / Receive / Exchange / More) instead of a nav surface.
    // Destinations that are NOT quick actions are not reachable this way; see
    //  before writing an extension spec that needs one.
    await page.getByRole('main').getByRole('button', { name, exact: true }).click();
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
    // Heading copy differs per shell: "Verify your recovery phrase" in the
    // web app, "Verify phrase" in the extension popup. The challenge itself
    // (the "Word N" boxes below) is identical.
    await expect(
        page.getByRole('heading', { name: /Verify (your recovery )?phrase/i }),
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
 * Pass `navigate: false` when the page is ALREADY on the wallet, which is
 * the case for the MV3 extension venue: its popup is opened at
 * chrome-extension://<id>/popup.html and there is no baseURL to goto. The
 * onboarding walk itself is identical, and keeping one copy of it is the
 * reason this fixture exists at all.
 *
 * @returns {Promise<string[]>} the generated recovery phrase
 */
export async function createWallet(page, options = {}) {
    const { password = DEFAULT_PASSWORD, name, ads = 'decline', navigate = true } = options;

    if (navigate) await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Create new wallet' }).click();

    if (name) await page.getByLabel('Wallet name').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(password);
    // The shells label this field differently: the web app says "Confirm
    // password", the extension popup shortens it to "Confirm" for its narrow
    // width. Match both rather than forking the walk.
    await page.getByLabel(/^Confirm( password)?$/).fill(password);
    await page.getByRole('button', { name: 'Next' }).click();

    const words = await readRecoveryPhrase(page);
    // Wording differs per shell again: the web app says "I have written
    // down...", the extension popup says "I've saved my recovery phrase."
    await page.getByLabel(/written down|saved my recovery phrase/i).check();
    await page.getByRole('button', { name: 'Verify recovery phrase' }).click();

    await completeRecoveryPhraseChallenge(page, words);
    await page.getByRole('button', { name: 'Create wallet' }).click();

    await acknowledgeDonationConsent(page, ads);

    // Argon2id runs on the CI runner's CPU; this is the slow step.
    await expect(unlockedShell(page)).toBeVisible({ timeout: 90_000 });
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
    const welcome = page.getByRole('button', { name: 'Create new wallet' });

    // Wait for whichever screen this build actually paints, rather than giving
    // the carousel a fixed head start. The old 5s wait was a race the cold
    // dev-server compile could lose: the helper then no-opped as "no carousel"
    // and the caller sat out its full 120s timeout waiting for a button that
    // was one screen away - the same failure this helper exists to prevent.
    await skip.or(welcome).first().waitFor({ state: 'visible', timeout: 60_000 });

    // Tolerant by design: if the carousel is ever removed, there is no Skip and
    // we are already where the caller needs to be.
    if (await skip.count() === 0) return;

    await skip.click();
    await welcome.waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * Answers the ADS donation-consent screen shown at the end of onboarding.
 *
 * Tolerant by design, like dismissIntroCarousel: the consent step lives in
 * the shared CreateWallet route the web shell uses, and the extension popup
 * has its OWN onboarding implementation that does not include it. Waiting
 * unconditionally would hang every extension spec on a screen that is never
 * coming. Returns false when there was nothing to answer.
 */
export async function acknowledgeDonationConsent(page, choice = 'decline') {
    const button =
        choice === 'enable'
            ? page.getByRole('button', { name: /Enable and continue/i })
            : page.getByRole('button', { name: /Decline/i });
    try {
        await button.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
        return false;               // shell has no consent step
    }
    await button.click();
    return true;
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
