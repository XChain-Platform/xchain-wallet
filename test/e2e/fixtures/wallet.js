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
// Onboarding is the wallet's most-changed surface, so the walk lives
// behind this one seam rather than inside each spec: a new onboarding
// screen (license gate, recovery-phrase verification, ADS notice) is
// one edit here, not one per spec.
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
import { kdfStepTimeout } from '../timeout-budget.js';
import { stubPriceFeed } from './priceStub.js';

// Every wait below that pays a real Argon2id derivation shares ONE budget,
// scaled for the machine the run landed on. These were two hand-written
// 90_000s, and on a hosted runner - which the load-average model scores as
// idle, because it is small rather than contended - 90s was not enough.
// See test/e2e/timeout-budget.js.
const KDF_STEP_MS = kdfStepTimeout();

export const LICENSE_ACCEPTED_AT_KEY = 'xc:licenseAcceptedAt';
export const LICENSE_ACCEPTED_VERSION_KEY = 'xc:licenseAcceptedVersion';

export const DEFAULT_PASSWORD = 'e2epassword1234';

export const test = base.extend({
    // Set `test.use({ acceptLicense: false })` in a spec that wants to
    // drive the license gate itself.
    acceptLicense: [true, { option: true }],

    page: async ({ page, acceptLicense }, use) => {
        // No spec reaches the live price service; see priceStub.js.
        await stubPriceFeed(page.context());
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
 * responsive-first: the layout picks ONE nav surface from its own
 * measured width (packages/core/src/shared/styles/breakpoints.js). Below
 * 640px `<BottomTabBar>` ("Bottom navigation") owns navigation; from 640px
 * up it is the left rail ("Primary navigation"), labelled from 900px. The
 * MV3 popup is 400px wide, so it is ALWAYS in the bottom-bar band - a
 * fixture anchored on the rail alone finds nothing there, which is not a
 * wallet defect but a test that only knew one shell.
 *
 * Exactly one of the two is mounted at any width, which
 * tests/responsive/viewports.spec.js asserts in a real browser. Taking
 * `.first()` is belt-and-braces for a shell that pins a variant by hand.
 */
export function nav(page) {
    return page.getByRole('navigation', { name: 'Primary navigation' })
        .or(page.getByRole('navigation', { name: 'Bottom navigation' }))
        .first();
}

/**
 * The unlocked shell's signal that onboarding finished, in ANY shell.
 *
 * Anchored on Home's `<section aria-label="Active address balance">` (core's
 * `TotalBalanceHero`, rendered via `HomeTabs` by every shell) rather than on
 * navigation, because the three shells do not agree on navigation at all:
 * web/desktop render the rail or the bottom bar, and the MV3 popup renders
 * NEITHER - it is a route-per-view shell with no shared layout wrapper
 * (`packages/extension/src/popup/App.jsx:600-603` says so explicitly), so no
 * nav landmark exists there to wait on.
 *
 * The nav rail's Lock button is not usable for this either: below 640px it
 * lives inside the More sheet, which is closed by default.
 */
export function unlockedShell(page) {
    return page.getByRole('region', { name: 'Active address balance' }).first();
}

/**
 * The unlocked shell on WHICHEVER screen it opens, for waits that follow a
 * reload.
 *
 * An unlock after a reload resumes the wallet's last view (`useLastView`,
 * §24 / G055), so a spec that reloaded on Addresses comes back on Addresses
 * and Home's balance hero never renders. Every shell mounts the shared
 * "App header" region only inside its unlocked layout (web, desktop, and the
 * popup's non-Home views), and the popup's Home carries the hero instead, so
 * one of the two is on screen once the wallet is open and neither is on the
 * lock screen.
 */
export function unlockedAnyScreen(page) {
    return unlockedShell(page)
        .or(page.getByRole('region', { name: 'App header', exact: true }))
        .first();
}

/**
 * Opens Settings, by whichever route this shell offers.
 *
 * The MV3 popup has no navigation surface. Its entry point is the gear
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
        await openPaletteCommand(page, 'Settings');
    }
    await expect(page.getByRole('button', { name: /^Developer mode/ }))
        .toBeVisible({ timeout: 15_000 });
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The command palette dialog, open or not. */
export function commandPalette(page) {
    return page.getByRole('dialog', { name: 'Command palette' });
}

/**
 * Opens the command palette and types `query` into its own search field.
 *
 * The search field is found INSIDE the dialog by its name. A page-wide
 * `getByRole('combobox').first()` resolves to whatever select sits earlier in
 * the DOM (Home's "Sort balances", a form's Currency picker) and fails with
 * "Element is not an <input>".
 *
 * Cmd/Ctrl+K toggles the palette, and the shell closes it on its own whenever
 * the view changes under it (a screen still settling after an unlock or a
 * wallet switch). So the shortcut is pressed only while the dialog is absent,
 * and open-and-type retries as one step until the field really holds the
 * query. Bounded, so a palette that never opens fails in seconds with that
 * sentence instead of waiting out the test timeout.
 *
 * @returns {Promise<import('@playwright/test').Locator>} the open dialog
 */
export async function openPaletteSearch(page, query, { timeoutMs = 30_000 } = {}) {
    const dialog = commandPalette(page);
    const search = dialog.getByRole('combobox', { name: 'Search commands' });
    await expect(async () => {
        if (!(await dialog.isVisible())) await page.keyboard.press('ControlOrMeta+k');
        await expect(search, 'the command palette did not open').toBeEditable({ timeout: 3_000 });
        await search.fill(query, { timeout: 3_000 });
        await expect(search).toHaveValue(query, { timeout: 2_000 });
    }, `the command palette never opened with "${query}" typed into its search field`)
        .toPass({ timeout: timeoutMs });
    return dialog;
}

/**
 * Runs one command palette entry by its title, and waits for the palette to
 * close behind it.
 *
 * The option is matched as an anchored word prefix of its accessible name,
 * because a row's name carries its subtitle after the title.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} title  the command's visible title, typed as the search
 * @param {{ option?: RegExp, timeoutMs?: number }} [opts]  `option` overrides the row match
 */
export async function openPaletteCommand(page, title, { option, timeoutMs = 30_000 } = {}) {
    const dialog = await openPaletteSearch(page, title, { timeoutMs });
    const row = dialog.getByRole('option', { name: option || new RegExp(`^${escapeRegExp(title)}\\b`) }).first();
    await expect(row, `no palette command matching "${title}"`).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(dialog, `the command palette stayed open after choosing "${title}"`)
        .toBeHidden({ timeout: 15_000 });
}

/**
 * The active wallet's identity in the App header.
 *
 * The header names the active wallet in a `WalletIdentity` span (not a
 * button), and the wallet picker closes itself after a pick, so this is the
 * one place a switch can be confirmed.
 */
export function activeWalletIdentity(page) {
    return page.getByRole('region', { name: 'App header' }).getByTestId('wallet-identity');
}

/** Asserts the App header names `name` as the active wallet. */
export async function expectActiveWallet(page, name, message, { timeoutMs = 30_000 } = {}) {
    await expect(activeWalletIdentity(page).filter({ hasText: name }),
        message || `the app did not switch to ${name}`)
        .toBeVisible({ timeout: timeoutMs });
}

/**
 * Switches to the wallet called `name` through the palette's Switch wallet
 * screen, and confirms it in the App header.
 *
 * The row is told apart from its own "Wallet details for <name>" button,
 * which carries the same name.
 */
export async function switchToWallet(page, name, { timeoutMs = 30_000 } = {}) {
    await openPaletteCommand(page, 'Switch wallet');
    const row = page.getByRole('main')
        .getByRole('button', { name: new RegExp(`^(?!Wallet details for).*${escapeRegExp(name)}`) })
        .first();
    await expect(row, `the wallet picker lists no wallet named ${name}`).toBeVisible({ timeout: timeoutMs });
    await row.click();
    await expectActiveWallet(page, name, undefined, { timeoutMs });
}

/**
 * Adds a second wallet inside the unlocked session, then switches to it.
 *
 * Adding a wallet does not make it active: the add flow ends on App's
 * `refresh`, which returns to the wallet the session started on. So this
 * switches explicitly and confirms the switch in the App header.
 *
 * @returns {Promise<string[]>} the new wallet's recovery phrase
 */
export async function addWallet(page, { name, password = DEFAULT_PASSWORD, ads = 'off' } = {}) {
    if (!name) throw new Error('addWallet needs a name, so the switch to it can be confirmed');
    await openPaletteCommand(page, 'Switch wallet');
    await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
    // navigate:false: the add flow starts at the onboarding welcome inside the
    // unlocked shell, and a goto('/') would drop the session.
    const words = await createWallet(page, { password, name, ads, navigate: false });
    await switchToWallet(page, name);
    return words;
}

/**
 * A nav destination by name, tolerating the badge that rides in its
 * accessible name.
 *
 * A nav item with unread items reads "Messaging 5 unread", not
 * "Messaging": the count pill carries `aria-label="5 unread"` and the
 * accessible name is the concatenation. An exact match therefore finds
 * the item right up until the wallet has something to tell the user
 * about, which is precisely when a test is most likely to be looking at
 * it. (This bit the width walk: the same click passed on an empty
 * wallet and hung on a populated one.)
 *
 * Exact first so a name that IS another's prefix cannot be hijacked, then
 * an anchored prefix so the badge suffix is tolerated. Anchored, not
 * substring: `getByRole(..., { name })` without `exact` matches anywhere
 * in the name, which would let "Send" also select "Resend".
 */
function navDestination(scope, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
        exact: scope.getByRole('button', { name, exact: true }),
        prefixed: scope.getByRole('button', { name: new RegExp(`^${escaped}\\b`) }),
    };
}

// A destination can sit in the DOM of a collapsed nav without being shown
// (the phone bar keeps its More sheet rows mounted off screen); only one that
// is visible inside the viewport is a click target, otherwise the caller
// falls through to More.
async function onScreen(locator) {
    if (!(await locator.isVisible())) return false;
    const box = await locator.boundingBox({ timeout: 2_000 }).catch(() => null);
    if (!box) return false;
    const viewport = locator.page().viewportSize();
    if (!box || !viewport) return Boolean(box);
    return box.x + box.width > 0 && box.y + box.height > 0
        && box.x < viewport.width && box.y < viewport.height;
}

// The landscape icon rail and the open More sheet both scroll inside a short
// viewport (or under enlarged text spacing), so a row can be scrolled out of
// view; bring it back before the on-screen check. The closed phone bar's
// off-screen sheet rows are neither, so they still fall through to More.
// A resize can unmount the row between the count and these calls, so each
// is bounded and a vanished row simply counts as not on screen.
async function revealInScroller(locator) {
    if (await locator.count() === 0) return;
    try {
        const scrolls = await locator.first().evaluate((el) => {
            const navEl = el.closest('nav');
            if (navEl && navEl.getAttribute('aria-label') === 'Primary navigation') return true;
            const sheet = el.closest('[role="dialog"]');
            return Boolean(sheet && sheet.getAttribute('aria-labelledby')
                && document.getElementById(sheet.getAttribute('aria-labelledby'))?.textContent?.trim() === 'More');
        }, undefined, { timeout: 2_000 });
        if (scrolls && await locator.first().isVisible()) {
            await locator.first().scrollIntoViewIfNeeded({ timeout: 2_000 });
        }
    } catch {
        // Gone mid-resize: the caller's on-screen check decides.
    }
}

async function clickDestination(scope, name) {
    const { exact, prefixed } = navDestination(scope, name);
    await revealInScroller(exact);
    await revealInScroller(prefixed);
    if (await exact.count() > 0 && await onScreen(exact.first())) {
        await exact.first().click();
        return true;
    }
    if (await prefixed.count() > 0 && await onScreen(prefixed.first())) {
        await prefixed.first().click();
        return true;
    }
    return false;
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
        // Landscape phones can show the rail and the bottom bar together, so
        // try every nav on screen before opening the More sheet. Right after
        // a resize the shell can still be swapping the bottom bar for the
        // rail, so a More button that vanishes means "look again", not
        // "wait for it forever".
        const navs = [
            page.getByRole('navigation', { name: 'Primary navigation' }),
            page.getByRole('navigation', { name: 'Bottom navigation' }),
        ];
        const more = page.getByRole('button', { name: 'More', exact: true });
        for (let attempt = 0; attempt < 3; attempt += 1) {
            for (const candidate of navs) {
                if (await candidate.count() === 0) continue;
                if (await clickDestination(candidate.first(), name)) return;
            }
            if (await more.count() === 0) {
                await page.waitForTimeout(500);
                continue;
            }
            try {
                await more.first().click({ timeout: 10_000 });
            } catch {
                await page.waitForTimeout(500);
                continue;
            }
            const sheet = page.getByRole('dialog', { name: 'More', exact: true });
            await sheet.waitFor({ state: 'visible', timeout: 15_000 });
            if (await clickDestination(sheet, name)) return;
            break;
        }
        throw new Error(`no nav destination named "${name}" in the nav or the More sheet`);
    }

    // No nav landmark at all: the MV3 popup. It navigates from Home's quick
    // actions (Send / Receive / Exchange / More) instead of a nav surface.
    // Destinations that are NOT quick actions are not reachable this way; see
    // before writing an extension spec that needs one.
    if (await clickDestination(page.getByRole('main'), name)) return;
    throw new Error(`no quick action named "${name}" on this screen`);
}

/** A button inside the main content region, e.g. a form's submit. */
export function mainButton(page, name) {
    return page.getByRole('main').getByRole('button', { name, exact: true });
}

/**
 * The nav rail's "Lock" button. Only the phone layout's header carries a
 * "Lock wallet" button (never beside the rail), but a substring match on
 * "Lock" would still hit it, so anchor on the exact accessible name.
 */
export function lockButton(page) {
    return page.getByRole('button', { name: 'Lock', exact: true });
}

/**
 * Reveals the recovery phrase on the mnemonic display stage.
 *
 * The phrase is concealed until the user asks for it (MnemonicGrid, §19.2):
 * the stage opens on a "Reveal recovery phrase" button and no word list at
 * all. Asserting that before the click keeps the concealment covered by
 * every spec that walks onboarding, not only by the unit test.
 */
export async function revealRecoveryPhrase(page) {
    const list = page.getByRole('list', { name: 'Recovery phrase' });
    const reveal = page.getByRole('button', { name: 'Reveal recovery phrase' });
    await expect(reveal, 'the mnemonic stage should open with the phrase concealed').toBeVisible();
    await expect(list).toHaveCount(0);
    await reveal.click();
    await expect(list).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide recovery phrase' })).toBeVisible();
    return list;
}

/** Reveals, then reads the 12/24 recovery words off the mnemonic display stage, in order. */
export async function readRecoveryPhrase(page) {
    const list = await revealRecoveryPhrase(page);
    const items = await list.getByRole('listitem').allInnerTexts();
    // Each item renders as "<position>. <word>"; the word is the last token.
    const words = items.map((text) => text.trim().split(/\s+/).pop());
    expect([12, 24], `read ${words.length} recovery words`).toContain(words.length);
    return words;
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
 * ADS is turned OFF by default, in Settings, right after the onboarding
 * notice: an enabled donation adds an extra output to outgoing
 * transactions, which would perturb the amounts and fees the send specs
 * assert on. Pass `ads: 'on'` to leave the wallet's default in place.
 *
 * Pass `navigate: false` when the page is ALREADY on the wallet, which is
 * the case for the MV3 extension venue: its popup is opened at
 * chrome-extension://<id>/popup.html and there is no baseURL to goto. The
 * onboarding walk itself is identical, and keeping one copy of it is the
 * reason this fixture exists at all.
 *
 * Pass `bip39Passphrase` to take the "Use a BIP39 passphrase (advanced)"
 * branch. That produces an ORDINARY wallet: the passphrase typed here is
 * sealed onto the record under the wallet's own master key, and every later
 * unlock pools a signer from the password alone. It is no longer a way to reach
 * a wallet with `signerReady` false.
 *
 * The state that HAS no signer is now the legacy one - `passphraseEnabled` true
 * with nothing stored - and no create walk can produce it, because create
 * always stores what it was given. A browser reaches it only by restoring the
 * pre-spec backup envelope in `test/e2e/fixtures/`; see
 * `tests/wallet/passphrase-stored.regtest.spec.js`, which drives it, and the
 * generator beside the envelope, which builds it.
 *
 * @returns {Promise<string[]>} the generated recovery phrase
 */
export async function createWallet(page, options = {}) {
    const {
        password = DEFAULT_PASSWORD, name, ads = 'off', navigate = true,
        bip39Passphrase = null,
    } = options;

    if (navigate) await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Create new wallet' }).click();

    if (name) await page.getByLabel('Wallet name').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(password);
    // The shells label this field differently: the web app says "Confirm
    // password", the extension popup shortens it to "Confirm" for its narrow
    // width. Match both rather than forking the walk.
    // Anchored so it cannot capture "Confirm passphrase", which the branch
    // below reveals directly underneath it.
    await page.getByLabel(/^Confirm( password)?$/).fill(password);
    if (bip39Passphrase !== null) {
        await page.getByLabel(/^Use a BIP39 passphrase/).check();
        await page.getByLabel('BIP39 passphrase', { exact: true }).fill(bip39Passphrase);
        await page.getByLabel('Confirm passphrase', { exact: true }).fill(bip39Passphrase);
    }
    // WAIT FOR `Next` TO BE ENABLED, AND RE-TYPE ONCE IF IT IS NOT. The button
    // is disabled until both password fields hold a matching, valid value, and
    // twice on 2026-09-02 a whole-suite run lost 420 seconds to it sitting
    // disabled forever: Playwright's click retries a disabled button until the
    // TEST budget runs out, so the failure surfaces as "Test timeout exceeded"
    // pointing at a click, with nothing about which field did not take. One
    // re-type is enough for the race it is (a fill that lands while the form is
    // still binding), and a form that is genuinely refusing the password now
    // fails in seconds saying so instead of hanging the run.
    const next = page.getByRole('button', { name: 'Next' });
    if (!(await next.isEnabled().catch(() => false))) {
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByLabel(/^Confirm( password)?$/).fill(password);
    }
    await expect(next, 'the password step will not advance: Next is still disabled after both '
        + 'fields were filled twice, so the form is refusing this password rather than racing')
        .toBeEnabled({ timeout: 30_000 });
    await next.click();

    const words = await readRecoveryPhrase(page);
    // Wording differs per shell again: the web app says "I have written
    // down...", the extension popup says "I've saved my recovery phrase."
    await page.getByLabel(/written down|saved my recovery phrase/i).check();
    await page.getByRole('button', { name: 'Verify recovery phrase' }).click();

    await completeRecoveryPhraseChallenge(page, words);
    await page.getByRole('button', { name: 'Create wallet' }).click();

    await acknowledgeDonationNotice(page, ads);

    // Argon2id runs on the CI runner's CPU; this is the slow step.
    await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });
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
 * Acknowledges the Automatic Donation System notice shown at the end of
 * onboarding, then (by default) turns donations off in Settings.
 *
 * The notice informs; it does not ask (spec §36.1). It has one Continue
 * button and no decline, so `ads: 'off'` takes the walk a user would: Settings
 * -> Automatic Donation System -> the switch. `ads: 'on'` only continues.
 *
 * Tolerant by design, like dismissIntroCarousel: the notice lives in
 * the shared CreateWallet route the web shell uses, and the extension popup
 * has its OWN onboarding implementation that does not include it. Waiting
 * unconditionally would hang every extension spec on a screen that is never
 * coming. Returns false when there was nothing to answer.
 *
 * WHAT IT MUST NOT DO IS WAIT ON A CLOCK. This screen renders on the far
 * side of the Argon2id derivation that "Create wallet" kicks off, so a fixed
 * budget here is a bet on the KDF finishing inside it, not on a render. The
 * bare `10_000` this replaced lost that bet on roughly a quarter of CI runs:
 * the helper returned false, `createWallet` then waited its full KDF budget
 * for a shell still sitting behind an unanswered notice screen, and the run
 * reported a 180s timeout on `unlockedShell` - a signature that reads as a
 * slow KDF and is nothing of the kind. Nine of nine failing and flaky tests
 * in run 30930194072 died on this screen. Same defect as the bare 90_000
 * that BASE_KDF_STEP_TIMEOUT_MS was extracted from, one function away.
 *
 * So race the two outcomes instead: either the notice arrives, or
 * this shell has none and the wallet itself does. Whichever lands first ends
 * the wait, which keeps the extension venue fast without pinning any number
 * to the derivation.
 */
export async function acknowledgeDonationNotice(page, ads = 'off') {
    const notice = page.getByRole('heading', { name: 'Automatic Donation System', exact: true });
    await notice.or(unlockedShell(page)).first()
        .waitFor({ state: 'visible', timeout: KDF_STEP_MS });
    // The shell won the race, so there is no notice here to acknowledge.
    if (!(await notice.isVisible())) return false;
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    if (ads === 'off') await turnOffDonations(page);
    return true;
}

/**
 * Answers the notice that now ends every IMPORT: a recovery phrase, the
 * FreeWallet migration, and a backup or backup-pointer restore, in both
 * 'fresh' and 'add' modes (ImportWallet.jsx hands over to onImported only
 * from the notice's Continue button).
 *
 * Call it right after the Import or Restore click and before waiting for the
 * unlocked shell: the shell is not coming until Continue is pressed, so a
 * spec that waits for it first sits out its whole KDF budget on a screen that
 * needed one click. Defaults to `ads: 'on'` (just Continue), unlike the
 * create path, because an import spec that does not care about donations
 * should not pay for the Settings walk that switching them off costs.
 * Tolerant in the same way as acknowledgeDonationNotice, so the extension
 * venue, which has no notice, is a no-op.
 */
export async function acknowledgeImportNotice(page, ads = 'on') {
    return acknowledgeDonationNotice(page, ads);
}

/**
 * Turns the Automatic Donation System off the only way the wallet offers:
 * Settings -> Automatic Donation System. Ends back on Home.
 */
export async function turnOffDonations(page) {
    await expect(unlockedShell(page)).toBeVisible({ timeout: KDF_STEP_MS });
    await openSettings(page);
    await page.getByRole('button', { name: /^Automatic donation system/ }).click();
    const toggle = page.getByRole('switch', { name: 'Turn on Automatic Donation System', exact: true });
    await expect(toggle).toBeVisible();
    if (await toggle.isChecked()) {
        // Click, not check(): the input is controlled by PERSISTED settings,
        // so `checked` flips only once the vault write resolves.
        await toggle.click();
        await expect(toggle).not.toBeChecked();
    }
    await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
    if (await nav(page).count() > 0) await gotoSection(page, 'Home');
    else await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(unlockedShell(page)).toBeVisible();
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
    await page.getByLabel('Password', { exact: true }).fill(password);
    await unlockButton(page).click();
    // Argon2id again: unlocking derives the master key. Same budget.
    await expect(lockButton(page)).toBeVisible({ timeout: KDF_STEP_MS });
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
