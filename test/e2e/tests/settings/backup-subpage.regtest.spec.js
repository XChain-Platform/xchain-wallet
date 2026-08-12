// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Campaign coverage map, "Settings sub-pages" -> the BACKUP sub-page, the last
// of the four the 2026-08-03 re-scope found undriven.
//
// WHAT WAS ALREADY COVERED, so this spec does not re-prove it. The Backup
// sub-page offers four affordances and two of them already have owners:
//   - "Test backup (dry-run restore)" is driven end to end by
//     tests/onboarding/backup-dry-run.regtest.spec.js (§19.6).
//   - "Export encrypted backup" is driven, all the way to a RESTORE that then
//     signs, by tests/onboarding/backup-pointer-restore.regtest.spec.js, which
//     exports through this very row.
//   - "Publish labels on-chain" is NOT driven here: it broadcasts a FILE action
//     and pays a network fee, so it belongs to a chain lane rather than to a
//     settings-surface spec. Its row is pinned as OFFERED below and no more.
// What was left with no owner at all is the one row that hands over the master
// key: "Back up seed phrase" (§19.3). That is what this spec drives.
//
// WHY THAT ROW IS WORTH A SPEC OF ITS OWN. Everything else on this sub-page can
// be wrong and cost the user a file. This one can hand the wallet to whoever is
// looking at the screen. `revealMnemonic` is deliberately a bare primitive -
// its own header says "the shell UI is responsible for the user-facing
// guardrails: tap-to-reveal, auto-hide on blur, no clipboard write, mandatory
// password every time". Every one of those guardrails therefore exists ONLY in
// the component this spec drives, and none of them is visible from the flow.
//
// THE FOUR CLAIMS, and each is a different way the screen can betray the user:
//   1. The phrase is not in the page BEFORE the password gate. A screen that
//      pre-fetches the seed and merely declines to paint it has already lost
//      it: it is in the DOM, in a heap dump, in an extension's reach.
//   2. A WRONG password reveals nothing. This is the gate itself. The
//      surrounding UI is decoration if it opens for any string.
//   3. The right password reveals THIS wallet's phrase, and it arrives BLURRED
//      until the user taps. The blur is asserted from the computed style, not
//      from the caption that claims it - a caption saying "Tap to reveal" over
//      unblurred text is exactly the D-70 shape this area keeps producing: a
//      control that is described and not applied.
//   4. Done really hides it. Not "hidden again" in the CSS sense: GONE from the
//      DOM, and still gone after a reload, with the password gate re-armed.
//      "Hide does not hide" is failure mode 3 from the addresses/secret-reveal
//      lane, on the same class of secret.
//
// THE PREDICATE IS THE SAME IN ALL FOUR, AND IT IS DRIVEN TO BOTH VERDICTS.
// `phraseInPage()` asks one question - is this phrase anywhere in the serialized
// DOM - and the spec asserts FALSE before the gate, FALSE on a wrong password,
// TRUE once revealed, FALSE after Done, FALSE after a reload. A predicate that
// answered "no" unconditionally would fail step 3; one that answered "yes"
// unconditionally would fail step 2. Neither verdict can be vacuous.
//
// ⚠️ IT MUST NOT LEAK THE PHRASE, the Session 38 rule from the secret-reveal
// lane, which applies here with the volume turned up: this is not one address's
// key, it is the wallet's. A failing `toContain` / `toEqual` prints both sides,
// so every assertion below is reduced to a BOOLEAN in Node first, no message
// interpolates a word, and the phrase is never passed INTO the page as an
// evaluate argument (`page.content()` comes out, the comparison happens here).
// The next person to extend this file will reach for the natural matcher;
// please do not.
//
// NO CHAIN. Nothing broadcasts, funds or indexes; this is vault + UI only. It
// runs on the regtest config because that is where the production-build venue
// lives (the dev server serves a mock SDK).
//
// RUN IT:
//   cd test/e2e && XC_REGTEST_COIN=RBTC XC_PREVIEW_PORT=4184 XC_REUSE_BUILD=1 \
//       npx playwright test --config=playwright.regtest.config.js \
//       tests/settings/backup-subpage.regtest.spec.js

import { createWallet, expect, openSettings, test } from '../../fixtures/wallet.js';
import { unlockAfterReload } from '../../fixtures/regtest.js';

const PASSWORD = 'regtestpassword123';
/** Same length and shape as the real one, and emphatically not it. */
const WRONG_PASSWORD = 'regtestpassword124';

/** The four affordances the sub-page is supposed to offer, row -> action. */
const OFFERED = [
    ['Export encrypted backup', 'Export…'],
    ['Back up seed phrase', 'Show…'],
    ['Test backup (dry-run restore)', 'Test…'],
    ['Publish labels on-chain', 'Publish now…'],
];

/** Opens Settings and walks into the Backup sub-page. */
async function openBackup(page) {
    await openSettings(page);
    // Scoped to `main`, and asserted visible BEFORE the click: the primary
    // navigation carries same-named destinations, and a Playwright click has no
    // default action timeout, so a miss hangs out the whole test budget instead
    // of failing.
    const row = page.getByRole('main').getByRole('button', { name: /^Backup/ }).first();
    await expect(row, 'Settings has no Backup row').toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Show…', exact: true }),
        'the Backup sub-page did not open').toBeVisible({ timeout: 30_000 });
}

/**
 * Is `phrase` anywhere in the page's serialized DOM?
 *
 * Deliberately asks the question in NODE rather than in the page: the phrase is
 * never handed to `page.evaluate` as an argument, so no browser-side failure
 * can echo it into a trace. The caller gets a boolean and nothing else.
 */
async function phraseInPage(page, phrase) {
    const html = await page.content();
    return html.includes(phrase);
}

/** The tap-to-reveal control, which holds the phrase as its own text. */
function seedToggle(page) {
    return page.getByRole('button', { name: /^(Reveal|Hide) seed phrase$/ });
}

test.describe('Settings: backup sub-page', () => {
    test.use({ actionTimeout: 30_000 });
    test.setTimeout(600_000);

    test('the seed-phrase row gates on the password, reveals only this wallet\'s phrase, and takes it back',
        async ({ page }) => {
            /** @type {string[]} */
            let words;
            /** The phrase as the screen renders it: one space-separated string. */
            let phrase = '';

            await test.step('create a wallet and keep its phrase', async () => {
                // createWallet returns the generated recovery phrase. It stays
                // in these locals, is never logged, and is never interpolated
                // into an assertion message.
                words = await createWallet(page, { password: PASSWORD, name: 'Backup Subpage Wallet' });
                expect(Array.isArray(words) && words.length >= 12,
                    'onboarding did not yield a recovery phrase, so there is nothing to gate on')
                    .toBe(true);
                phrase = words.join(' ');
            });

            await test.step('the sub-page offers the four backup affordances', async () => {
                await openBackup(page);
                const main = page.getByRole('main');
                for (const [label, action] of OFFERED) {
                    await expect(main.getByText(label, { exact: true }),
                        `the Backup sub-page no longer offers the "${label}" row`)
                        .toBeVisible({ timeout: 30_000 });
                    await expect(main.getByRole('button', { name: action, exact: true }),
                        `the "${label}" row has no "${action}" control, so the affordance is a label only`)
                        .toBeVisible({ timeout: 30_000 });
                }
            });

            await test.step('CLAIM 1: the phrase is not in the page before the password gate', async () => {
                expect(await phraseInPage(page, phrase),
                    'the wallet\'s seed phrase is already in the DOM on the Backup sub-page, before the '
                    + 'user has asked for it or proved who they are')
                    .toBe(false);

                await page.getByRole('main').getByRole('button', { name: 'Show…', exact: true }).click();
                await expect(page.getByLabel('Wallet password'),
                    'asking to see the seed phrase raised no password prompt at all')
                    .toBeVisible({ timeout: 30_000 });

                // The gate is up. If the seed arrived with it, the gate is a
                // curtain in front of a page that already holds the key.
                expect(await phraseInPage(page, phrase),
                    'the seed phrase was fetched into the page ALONGSIDE the password prompt, so the '
                    + 'gate guards only the pixels - the key is in the DOM of an unauthenticated screen')
                    .toBe(false);
            });

            await test.step('CLAIM 2: a wrong password reveals nothing', async () => {
                await page.getByLabel('Wallet password').fill(WRONG_PASSWORD);
                await page.getByRole('main').getByRole('button', { name: 'Reveal', exact: true }).click();

                // Wait for the attempt to SETTLE rather than racing it. Both
                // outcomes are waited for on purpose: the button's label is
                // "Revealing…" while the KDF runs, so a REFUSAL brings "Reveal"
                // back, and an acceptance replaces the whole prompt with the
                // seed panel. Waiting only for the button would make this line
                // fail first when the gate wrongly opens, and the run would
                // report "never came back from its busy state" for what is
                // actually the assertion below - measured on the F1
                // falsification run, where the correct password was fed in
                // here on purpose.
                await expect(
                    page.getByRole('main').getByRole('button', { name: 'Reveal', exact: true })
                        .or(page.getByText('Your seed phrase', { exact: true })).first(),
                    'the reveal attempt never came back from its busy state')
                    .toBeVisible({ timeout: 120_000 });

                await expect(page.getByText('Your seed phrase', { exact: true }),
                    'a WRONG wallet password opened the seed-phrase panel')
                    .toHaveCount(0);
                expect(await phraseInPage(page, phrase),
                    'a WRONG wallet password put the seed phrase into the page. The password prompt on '
                    + 'this row is the only thing standing between a borrowed laptop and the wallet')
                    .toBe(false);
                await expect(page.getByLabel('Wallet password'),
                    'the password prompt did not survive a failed attempt, so the user cannot retry')
                    .toBeVisible({ timeout: 30_000 });
            });

            await test.step('CLAIM 3: the right password reveals THIS wallet\'s phrase, blurred', async () => {
                await page.getByLabel('Wallet password').fill(PASSWORD);
                await page.getByRole('main').getByRole('button', { name: 'Reveal', exact: true }).click();

                await expect(page.getByText('Your seed phrase', { exact: true }),
                    'the wallet\'s OWN password did not open the seed-phrase panel, so either the row '
                    + 'is broken or the refusal above proved nothing')
                    .toBeVisible({ timeout: 120_000 });

                // The predicate's other verdict. Without this the FALSE
                // assertions above are equally consistent with a page that
                // never shows the phrase at all.
                expect(await phraseInPage(page, phrase),
                    'the panel opened but the phrase is not in it')
                    .toBe(true);

                const toggle = seedToggle(page);
                await expect(toggle, 'the revealed panel has no tap-to-reveal control')
                    .toBeVisible({ timeout: 30_000 });

                // The phrase on screen is THIS wallet's, compared as a boolean
                // so a failure prints `false`, not a seed.
                const shown = ((await toggle.textContent()) || '').trim();
                expect(shown === phrase,
                    'the seed-phrase panel is showing a phrase that is NOT the one this wallet was '
                    + 'created from, which is the worst possible answer: the user writes it down and '
                    + 'their backup restores nothing')
                    .toBe(true);

                // The blur, measured rather than believed. The caption says
                // "Tap to reveal"; this asserts the pixels agree with it.
                const hiddenFilter = await toggle.evaluate((el) => getComputedStyle(el).filter);
                expect(/blur\(/.test(hiddenFilter),
                    'the seed phrase is rendered in the clear while the screen says "Tap to reveal" - '
                    + 'a shoulder-surfing guard that is described and not applied')
                    .toBe(true);

                await toggle.click();
                // Two separate things, and the first run conflated them: that
                // the control changed STATE (its accessible name flips), and
                // that the pixels followed. The blur is a 200ms CSS transition,
                // so a single read taken the instant after the click samples it
                // mid-flight - `blur(4px)` is neither verdict. Poll for the
                // settled value instead of racing the animation.
                await expect(page.getByRole('button', { name: 'Hide seed phrase' }),
                    'tapping the phrase did not flip the tap-to-reveal control into its shown state')
                    .toBeVisible({ timeout: 30_000 });
                await expect.poll(
                    async () => /blur\(/.test(
                        await seedToggle(page).evaluate((el) => getComputedStyle(el).filter),
                    ),
                    {
                        message: 'tapping the blurred phrase did not unblur it, so the user cannot read '
                            + 'the backup they came here to write down',
                        timeout: 10_000,
                    },
                ).toBe(false);
            });

            await test.step('CLAIM 4: Done takes it out of the DOM, and the gate re-arms', async () => {
                await page.getByRole('main').getByRole('button', { name: 'Done', exact: true }).click();

                await expect(page.getByRole('main').getByRole('button', { name: 'Show…', exact: true }),
                    'the row did not collapse back to its idle state after Done')
                    .toBeVisible({ timeout: 30_000 });
                expect(await phraseInPage(page, phrase),
                    'Done hid the seed phrase without REMOVING it: it is still in the DOM of a screen '
                    + 'the user believes they closed')
                    .toBe(false);

                // A reload, not a re-render. The point is to separate a panel
                // that stopped painting the seed from a wallet that stopped
                // holding it on this screen - and to prove the password gate is
                // re-armed rather than remembered as "already satisfied".
                await page.reload();
                await unlockAfterReload(page, PASSWORD);
                await openBackup(page);

                expect(await phraseInPage(page, phrase),
                    'the seed phrase came back on its own after a reload')
                    .toBe(false);

                await page.getByRole('main').getByRole('button', { name: 'Show…', exact: true }).click();
                await expect(page.getByLabel('Wallet password'),
                    'the seed-phrase row stopped asking for the password after it had been given once, '
                    + 'so the "requires the wallet password every time" promise on this row is false')
                    .toBeVisible({ timeout: 30_000 });
                await expect(page.getByText('Your seed phrase', { exact: true }),
                    'the phrase was shown again without any password at all')
                    .toHaveCount(0);
            });
        });
});
