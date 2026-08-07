#!/usr/bin/env node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §5 / stage S7: Chrome Web Store listing screenshots + promo tile.
//
// A REPEATABLE tool, not a one-off session: hand-taken screenshots rot the
// moment the UI changes and cannot be reproduced by the next person, so this
// drives the REAL built extension through Playwright, the same way
// test/e2e/fixtures/extension.js and extension-isolated.js do, and composites
// the results onto the Chrome Web Store's required canvas sizes.
//
// It produces artifacts; it asserts nothing, which is why it lives under
// scripts/ rather than test/e2e/tests/ - a spec failure should fail CI, an
// asset-generation failure should just fail loudly and tell the operator
// what broke.
//
// DEMO DATA ONLY. Every surface here is captured from the wallet's "Try in
// demo mode" onboarding lane (packages/core/src/shared/routes/Onboarding.jsx
// handleEnterDemo): a freshly generated, randomly seeded, never-funded BIP39
// wallet whose balances are synthetic overlays from
// packages/core/src/flows/demoFixtures.js (isDemoWallet short-circuits every
// balance/history fetch, so nothing here ever touches a real chain or a real
// endpoint). The address shown IS a real derived address, but it belongs to
// a throwaway wallet generated fresh by THIS SCRIPT RUN, never funded, and
// discarded with the temp Chrome profile when the script exits - not an
// operator's actual wallet. Listing images are permanent public artifacts,
// so this is the one thing this script must never get wrong.
//
// Approval-window binding note (see extension-isolated.js's header): the
// signAction/signMessage approval window only receives its
// chrome.runtime.sendMessage binding when Chromium's site isolation is ON,
// so this script does NOT pass --disable-web-security /
// --disable-features=IsolateOrigins,site-per-process the way
// fixtures/extension.js does for the regtest venue. Demo mode makes no chain
// fetches at all (that is the whole point of the fixture data), so it never
// needed the CORS workaround those flags exist for.
//
// Usage:
//   pnpm --filter @xchain-wallet/extension build
//   node packages/extension/scripts/capture-listing-screenshots.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSE_VERSION } from '../../core/src/buildInfo.js';
// One map of what each asset is, shared with the verifier rather than
// restated here, so the capture and the check cannot come to disagree about
// which four files this produces.
import { ASSETS, writePin } from '../../../tools/release/verify-listing-assets.mjs';

// Answered before anything else, and this one is not a courtesy. Without it,
// `--help` was not recognised as a flag at all: the script ignored it and ran
// the full capture, launching a browser, creating and unlocking a demo wallet,
// switching networks and overwriting the listing assets on disk. It then
// exited 0, so it looked like a help screen had been printed. A tool that does
// heavy, side-effecting work when asked how to use it is the worst version of
// this defect, and it hid behind a passing exit code until the check that
// covers the sibling tools was pointed at it.
//
// "Before anything else" was only true of the STATEMENTS, and that is not
// where a module starts ( row 50). An ES module evaluates every static
// import before its first statement, so in a tree with no node_modules this
// block never ran: the process died on `@playwright/test` with a
// module-not-found stack trace, which is the same defect this comment
// describes wearing a different failure. The three imports that reach
// node_modules are therefore loaded BELOW, dynamically, after this exits.
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(`Capture the Chrome Web Store listing screenshots and promo tile.

Usage:
  node packages/extension/scripts/capture-listing-screenshots.mjs

Requires the extension to be built first:
  pnpm --filter @xchain-wallet/extension build

WHAT THIS DOES, because it is not read-only: it launches a browser with the
built extension loaded, creates and unlocks a DEMO wallet, drives the UI, and
OVERWRITES the four listing assets in packages/extension/docs/listing-assets/
(three 1280x800 screenshots and the 440x280 promo tile).

Demo data only. It never touches a real wallet, and the store listing shows
only what this produces.`);
    process.exit(0);
}

// Everything below here needs installed dependencies; nothing above did.
// Top-level await, so the bindings are as ordinary as static ones for the
// rest of the file - the only thing that changed is that they are resolved
// after --help has had its chance to answer.
const { chromium } = await import('@playwright/test');
const { default: sharp } = await import('sharp');
// Reused, not duplicated: the same localStorage-seeding keys and DOM walks
// the extension e2e suite already verified against this UI. Plain functions
// that take a Playwright `page`, so they work fine outside the Playwright
// test-runner fixture system this script isn't running under. It imports
// @playwright/test itself, which is why it moved down here with the rest.
const {
    LICENSE_ACCEPTED_AT_KEY,
    LICENSE_ACCEPTED_VERSION_KEY,
    unlockedShell,
    openSettings,
    dismissIntroCarousel,
} = await import('../../../test/e2e/fixtures/wallet.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = path.resolve(HERE, '../dist');
const OUT_DIR = path.resolve(HERE, '../docs/listing-assets');
const LOGO_PATH = path.resolve(HERE, '../../core/src/branding/images/xchain-color-750.png');

// Chrome Web Store's fixed canvas sizes (spec §5).
const SCREENSHOT_W = 1280;
const SCREENSHOT_H = 800;
const TILE_W = 440;
const TILE_H = 280;

// packages/core/src/ui/tokens.css: --xc-accent-primary / --xc-accent-secondary
// and the light-theme background pair. Reused here so the composited canvas
// reads as the same product rather than a mismatched marketing wrapper.
const ACCENT_PRIMARY = '#1A7BAC';
const ACCENT_SECONDARY = '#7B2C8F';
const BG_LIGHT = '#F5F6F8';
const BG_LIGHTER = '#FFFFFF';
const BORDER = '#C7CCD4';
const TEXT = '#0F172A';
const TEXT_MUTED = '#5F7086';

const DAPP_ORIGIN = 'https://xchain-wallet-demo-dapp.test';

function log(msg) {
    console.log(`[capture-listing-screenshots] ${msg}`);
}

function fail(msg) {
    console.error(`[capture-listing-screenshots] FAILED: ${msg}`);
    process.exitCode = 1;
}

async function main() {
    if (!fs.existsSync(path.join(EXTENSION_DIST, 'manifest.json'))) {
        throw new Error(
            `Extension not built at ${EXTENSION_DIST}. Run: pnpm --filter @xchain-wallet/extension build`,
        );
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-ext-listing-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // Chromium only loads extensions in a headed context.
        args: [
            `--disable-extensions-except=${EXTENSION_DIST}`,
            `--load-extension=${EXTENSION_DIST}`,
            // Deliberately NO --disable-web-security / IsolateOrigins override:
            // see the header. This run needs the approval window's real
            // extension bindings and touches no chain, so it doesn't want the
            // regtest CORS workaround.
        ],
    });

    const produced = [];
    const missing = [];

    try {
        let sw = context.serviceWorkers()[0];
        if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
        const extensionId = new URL(sw.url()).host;
        log(`extension loaded, id=${extensionId}`);

        // ---- 1. Popup: onboard into demo mode, switch to Mainnet -----------
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 400, height: 700 });
        await seedLicense(popup);
        await popup.goto(`chrome-extension://${extensionId}/popup.html`);

        await dismissIntroCarousel(popup);
        await popup.getByRole('button', { name: 'Try in demo mode' }).click();
        await unlockedShell(popup).waitFor({ state: 'visible', timeout: 90_000 });
        log('demo wallet created and unlocked (popup)');

        await switchToMainnet(popup);
        await unlockedShell(popup).waitFor({ state: 'visible', timeout: 30_000 });
        log('active network switched to Mainnet');

        // Let balances / token icons settle before the screenshot. Demo mode
        // fetches nothing from a real chain, but token icon <img> tags do
        // load from their real (public, non-secret) URLs.
        await popup.waitForTimeout(1500);
        const popupPng = await popup.screenshot();
        await composeOnCanvas(popupPng, path.join(OUT_DIR, 'screenshot-popup.png'), {
            label: 'Toolbar popup, Home view',
        });
        produced.push('screenshot-popup.png');

        // ---- 2. Side panel: same origin, same unlocked session -------------
        // sidepanel.html mounts the identical React tree at a taller viewport
        // (packages/extension/sidepanel.html's own header comment). Chrome has
        // no Playwright-drivable "open the side panel" API, so this navigates
        // the built artifact directly, which renders byte-identical output.
        const sidepanel = await context.newPage();
        await sidepanel.setViewportSize({ width: 400, height: 760 });
        await seedLicense(sidepanel);
        await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        await unlockedShell(sidepanel).waitFor({ state: 'visible', timeout: 30_000 });
        // Switch to the Tokens tab so this screenshot shows different demo
        // content than the popup one: every non-native demo tick, including
        // EXAMPLE and PEPECREATURE (HomeTabs.jsx: "Tokens = every non-native
        // tick, regardless of divisibility or imagery"). The NFTs tab was
        // tried first but classifies collectibles by a live registry check
        // (LOCK_MAX_SUPPLY=1) that the offline demo fixtures never satisfy,
        // so it always renders "No collectibles yet" here.
        await sidepanel.getByRole('tab', { name: 'Tokens' }).click();
        await sidepanel.waitForTimeout(1500);
        const sidepanelPng = await sidepanel.screenshot();
        await composeOnCanvas(sidepanelPng, path.join(OUT_DIR, 'screenshot-sidepanel.png'), {
            label: 'Side panel, Tokens view',
        });
        produced.push('screenshot-sidepanel.png');

        // ---- 3. Sign-approval screen ----------------------------------------
        // signMessage is the one password-gated approval kind that needs no
        // funded wallet and no PSBT: a message signature only needs a key, not
        // spendable UTXOs. signPsbt / signAction approvals would need a funded
        // demo wallet and a real broadcastable (or at least fee-estimable)
        // transaction, which the throwaway demo wallet never has by design
        // (see demoFixtures.js: balances are a synthetic OVERLAY, the address
        // itself is never actually funded on any real chain). Recorded as a
        // gap below.
        try {
            const signApprovalPng = await captureSignApproval(context, popup);
            await composeOnCanvas(
                signApprovalPng,
                path.join(OUT_DIR, 'screenshot-sign-approval.png'),
                { label: 'Sign-approval window (dApp message signature)' },
            );
            produced.push('screenshot-sign-approval.png');
        } catch (err) {
            missing.push(`sign-approval screenshot: ${err && err.message ? err.message : err}`);
        }

        // ---- 4. Small promo tile (440x280), no browser needed --------------
        await composePromoTile(path.join(OUT_DIR, 'promo-tile-440x280.png'));
        produced.push('promo-tile-440x280.png');
    } finally {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    log(`produced: ${produced.join(', ') || '(none)'}`);
    if (missing.length > 0) {
        for (const m of missing) fail(m);
    }

    // Print measured dimensions for every file actually on disk, so the
    // operator (and the session report) states what was MEASURED, not what
    // was intended.
    for (const name of produced) {
        const file = path.join(OUT_DIR, name);
        const meta = await sharp(file).metadata();
        log(`${name}: ${meta.width}x${meta.height}`);
    }

    // Record WHICH BUILD these images depict. Their pixel dimensions cannot
    // say it and nothing else in the repo could, which is how four assets came
    // to sit three versions behind the release staged for submission with
    // every check green ( row 42). This is the only moment the answer is
    // knowable: the capture is the thing that drove the tree.
    //
    // Only on a COMPLETE capture. A partial one leaves the un-recaptured
    // asset's old bytes beside three new ones, and pinning that set would
    // record a build none of them all came from. Left un-pinned, the next
    // verify reports the three hash mismatches loudly, which is the honest
    // outcome.
    if (missing.length === 0 && produced.length === ASSETS.length) {
        const pin = writePin({ how: 'capture' });
        log(`pinned to ${pin.capturedFrom.commit.slice(0, 8)} (v${pin.capturedFrom.version}): `
            + 'docs/listing-assets/capture-pin.json');
    } else {
        fail('capture was INCOMPLETE, so the capture pin was NOT updated. The assets on disk are '
            + 'now a mixture of builds; re-run this script until it produces all four.');
    }
}

/** Seeds the license-gate localStorage keys, exactly like the e2e fixtures. */
async function seedLicense(page) {
    await page.addInitScript(
        ([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* gate renders and the walk fails loudly */ }
        },
        [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
    );
}

/**
 * Flips Settings → Network to Mainnet. The demo wallet lands on Regtest by
 * design (Onboarding.jsx's Cluster J FOLLOWUP 7 comment: it registers chains
 * on all three networks so the user can look at any of them), but a public
 * store screenshot showing "rBTC" reads as a testing artifact, not the
 * product. NetworkSection.jsx reloads the page on change; 'settings' is not
 * in RESUMABLE_VIEWS (lastViewMemory.js), so the reload lands back on Home.
 */
async function switchToMainnet(page) {
    await openSettings(page);
    const select = page.getByLabel('Active network');
    await select.waitFor({ state: 'visible', timeout: 15_000 });
    await select.selectOption('mainnet');
    // The select's onChange calls window.location.reload(); give the reload
    // + demo auto-unlock (Locked.jsx) time to run before the next wait.
    await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
}

/**
 * Drives a fake dApp origin through connect -> getAddresses -> signMessage,
 * over the real injected-provider route (window.xchain), and screenshots the
 * resulting SignApproval window. Mirrors
 * test/e2e/tests/cosigner/cosign-approval.extension.spec.js's approach
 * (connect via a routed fake origin, wait for the approval window by URL),
 * simplified to the one kind (signMessage) that needs no funded wallet.
 *
 * https:// scheme, not a bare custom TLD over plain http: the manifest's
 * post-D6 content-script matches are `https://*://` + loopback only (spec
 * §3.5 / §8 D6), and Playwright's route() intercepts the request before any
 * real DNS/TLS happens, so a fake https origin is exactly as easy to serve
 * and is the one that actually gets the provider injected.
 */
async function captureSignApproval(context, popup) {
    const dapp = await context.newPage();
    await dapp.route(`${DAPP_ORIGIN}/**`, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>XChain demo dApp</title><h1>XChain demo dApp</h1>',
    }));
    await dapp.goto(DAPP_ORIGIN + '/');
    await waitFor(
        () => dapp.evaluate(() => Boolean(window.xchain)),
        { timeout: 30_000, message: 'the provider was never injected into the demo dApp page' },
    );

    const connecting = dapp.evaluate(() => window.xchain.connect({}).then(
        (r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e && e.message || e) })));
    const connectApproval = await waitForApprovalPage(context, { timeout: 30_000 });
    await connectApproval.waitForLoadState('domcontentloaded');
    await connectApproval.getByRole('button', { name: 'Connect', exact: true })
        .waitFor({ state: 'visible', timeout: 20_000 });
    const bitcoinChain = connectApproval.getByRole('checkbox', { name: /^Allow Bitcoin\b/i }).first();
    await bitcoinChain.waitFor({ state: 'attached', timeout: 20_000 });
    if (!(await bitcoinChain.isChecked())) await bitcoinChain.check({ force: true });
    await clickAndLetItClose(connectApproval.getByRole('button', { name: 'Connect', exact: true }));
    const connectResult = await connecting;
    if (!connectResult.ok) throw new Error(`demo dApp connect failed: ${connectResult.e}`);

    const addresses = await dapp.evaluate(() => window.xchain.getAddresses('bitcoin-mainnet'));
    if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error('demo wallet returned no bitcoin-mainnet address to sign with');
    }
    const address = addresses[0].address;

    const requesting = dapp.evaluate(
        ({ address }) => window.xchain.signMessage({
            chainId: 'bitcoin-mainnet',
            address,
            message: 'Welcome to the XChain Wallet demo dApp! Sign to prove you control this address.',
        }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e && e.message || e) })),
        { address },
    );
    const signApproval = await waitForApprovalPage(context, { timeout: 30_000, pending: requesting });
    await signApproval.getByText('Sign message').first().waitFor({ state: 'visible', timeout: 20_000 });
    // Let the layout settle (password field focus, chain badge) before the shot.
    await signApproval.waitForTimeout(500);
    await signApproval.setViewportSize({ width: 400, height: 700 });
    const png = await signApproval.screenshot();

    // Clean up rather than leave the request hanging: reject it. Not part of
    // what the screenshot needed to show.
    await clickAndLetItClose(signApproval.getByRole('button', { name: 'Reject' }));
    return png;
}

/** Finds the approval popup window Chrome opened, by URL (not event order). */
async function waitForApprovalPage(context, { timeout = 30_000, pending = null } = {}) {
    const deadline = Date.now() + timeout;
    let settled = null;
    if (pending) pending.then((v) => { settled = v; }, (e) => { settled = { ok: false, e: String(e) }; });
    for (;;) {
        for (const p of context.pages()) {
            if (p.url().includes('approval.html')) {
                await p.waitForLoadState('domcontentloaded').catch(() => {});
                return p;
            }
        }
        if (settled) throw new Error(`the request settled without opening an approval: ${JSON.stringify(settled).slice(0, 300)}`);
        if (Date.now() > deadline) throw new Error(`no approval window appeared within ${timeout}ms`);
        await new Promise((r) => setTimeout(r, 250));
    }
}

/** Clicking Approve/Reject/Connect closes the window, racing the click's own settle. */
async function clickAndLetItClose(locator) {
    try {
        await locator.click({ noWaitAfter: true });
    } catch (e) {
        if (!/closed/i.test(String(e && e.message))) throw e;
    }
}

async function waitFor(predicate, { timeout = 30_000, interval = 250, message = 'condition never became true' } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
        if (await predicate()) return;
        if (Date.now() > deadline) throw new Error(message);
        await new Promise((r) => setTimeout(r, interval));
    }
}

/**
 * Composites a raw UI screenshot (natural popup/side-panel/approval-window
 * size) onto the Chrome Web Store's fixed 1280x800 canvas: a plain light
 * gradient (the wallet's own --xc-bg-muted → --xc-bg pair) with the
 * screenshot centered on a bordered card, plus a small caption in the
 * corner. No browser chrome mockup, no marketing copy: it says what the
 * screenshot shows and nothing more.
 */
async function composeOnCanvas(rawPng, outPath, { label }) {
    const raw = sharp(rawPng);
    const meta = await raw.metadata();
    const cardPad = 16;
    const cardW = meta.width + cardPad * 2;
    const cardH = meta.height + cardPad * 2;
    const cardLeft = Math.round((SCREENSHOT_W - cardW) / 2);
    const cardTop = Math.round((SCREENSHOT_H - cardH) / 2);
    const imgLeft = cardLeft + cardPad;
    const imgTop = cardTop + cardPad;

    const bg = svgBuffer(`
        <svg width="${SCREENSHOT_W}" height="${SCREENSHOT_H}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="${BG_LIGHTER}"/>
                    <stop offset="100%" stop-color="${BG_LIGHT}"/>
                </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#bg)"/>
            <rect x="${cardLeft}" y="${cardTop}" width="${cardW}" height="${cardH}" rx="14"
                  fill="#FFFFFF" stroke="${BORDER}" stroke-width="1"/>
            <text x="40" y="52" font-family="-apple-system,Helvetica,Arial,sans-serif"
                  font-size="22" font-weight="700" fill="${TEXT}">XChain Wallet</text>
            <text x="40" y="78" font-family="-apple-system,Helvetica,Arial,sans-serif"
                  font-size="15" fill="${TEXT_MUTED}">${escapeXml(label)}</text>
        </svg>
    `);

    await sharp(bg)
        .composite([{ input: rawPng, left: imgLeft, top: imgTop }])
        .png()
        .toFile(outPath);
}

/** Small promo tile: brand gradient, logo, name, one-line description. */
async function composePromoTile(outPath) {
    const logoTargetH = 96;
    const logo = await sharp(LOGO_PATH).resize({ height: logoTargetH }).toBuffer();
    const logoMeta = await sharp(logo).metadata();
    const logoLeft = Math.round((TILE_W - logoMeta.width) / 2);
    const logoTop = 36;

    const bg = svgBuffer(`
        <svg width="${TILE_W}" height="${TILE_H}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="${ACCENT_PRIMARY}"/>
                    <stop offset="100%" stop-color="${ACCENT_SECONDARY}"/>
                </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#tile)"/>
            <text x="${TILE_W / 2}" y="${logoTop + logoTargetH + 40}" text-anchor="middle"
                  font-family="-apple-system,Helvetica,Arial,sans-serif"
                  font-size="24" font-weight="700" fill="#FFFFFF">XChain Wallet</text>
            <text x="${TILE_W / 2}" y="${logoTop + logoTargetH + 64}" text-anchor="middle"
                  font-family="-apple-system,Helvetica,Arial,sans-serif"
                  font-size="14" fill="#EAF3FA">Self-custodial Bitcoin, Dogecoin &amp; Litecoin wallet</text>
        </svg>
    `);

    await sharp(bg)
        .composite([{ input: logo, left: logoLeft, top: logoTop }])
        .png()
        .toFile(outPath);
}

function svgBuffer(svg) {
    return Buffer.from(svg);
}

function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

main().catch((err) => {
    console.error('[capture-listing-screenshots] fatal:', err);
    process.exitCode = 1;
});
