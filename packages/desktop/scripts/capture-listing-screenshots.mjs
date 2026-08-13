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

// §13 / frontier row 95: Mac App Store listing screenshots.
//
// Apple refuses a listing with no screenshot, and until this file existed
// nothing in this repo could produce or check a picture of the DESKTOP shell:
// verify-listing-assets.mjs knew three Chrome Web Store PNGs, and the only
// capture script drove a browser extension. The mac-app-store ceremony page
// nonetheless said "the listing text, screenshots and icon are in place",
// which was a sentence about a pipeline that did not exist.
//
// A REPEATABLE TOOL, not a session. It launches the REAL Electron app through
// Playwright's Electron driver - the same mechanism
// test/smoke/shells/desktop-renders.smoke.js uses - drives it through the
// wallet's own demo lane, and screenshots the window at one of Apple's
// accepted canvases. Hand-taken screenshots rot the moment the UI moves and
// nobody can reproduce them; these can be re-cut by anyone, at any commit,
// with one command.
//
// It produces artifacts and asserts almost nothing, which is why it lives
// under scripts/ rather than test/: an asset-generation failure should fail
// loudly and say what broke, not fail CI on a UI commit. The one thing it DOES
// assert is the canvas size, because an image at the wrong size is refused by
// App Store Connect at the end of a submission rather than here.
//
// REPEATABLE MEANS BYTE-IDENTICAL . This script arms capture mode
// before the renderer loads, freezing the two inputs the demo lane randomizes
// per run: the demo wallet's mnemonic (the published BIP39 all-zero test
// vector, so the address in the images never moves and no reader mistakes it
// for a real seed) and the clock every synthesized timestamp is measured
// against. Without that, re-capturing an UNCHANGED tree produced different
// bytes and proved nothing. See packages/core/src/flows/demoCapture.js.
//
// DEMO DATA ONLY, for the same reason the extension capture says so at this
// length: listing images are permanent public artifacts. Every surface here
// comes from "Try in demo mode" (packages/core/src/shared/routes/
// Onboarding.jsx), a NEVER-FUNDED BIP39 wallet whose balances are synthetic
// overlays from
// packages/core/src/flows/demoFixtures.js - isDemoWallet short-circuits every
// balance and history fetch, so nothing here touches a real chain, a real
// endpoint or an operator's wallet. The profile it is created in is a temp
// directory that is deleted when this exits.
//
// Usage:
//   pnpm --filter @xchain-wallet/desktop run build:renderer
//   node packages/desktop/scripts/capture-listing-screenshots.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Answered before the heavy imports, and deliberately so: the extension
// capture script learned this the expensive way (row 50). An ES module
// evaluates every static import before its first statement, so a --help that
// lives below a `@playwright/test` import is a --help that dies with a
// module-not-found stack in any tree without node_modules - and one that lives
// below the launch is a --help that CREATES A WALLET.
if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(`Capture the Mac App Store listing screenshots of the desktop wallet.

Usage:
  node packages/desktop/scripts/capture-listing-screenshots.mjs [--size WxH]

Requires the renderer to be built first:
  pnpm --filter @xchain-wallet/desktop run build:renderer

WHAT THIS DOES, because it is not read-only: it launches the real Electron
app against a THROWAWAY profile, creates and unlocks a DEMO wallet, switches
it to Mainnet, drives the UI, and OVERWRITES the listing screenshots in
packages/desktop/docs/listing-assets/ plus their capture pin.

  --size WxH   canvas to capture at. One of Apple's accepted macOS sizes:
               1280x800, 1440x900, 2560x1600, 2880x1800. Default 1440x900.

Demo data only. The wallet it shows is generated fresh into a temp profile
and deleted with it; it is never funded and never touches a real chain.`);
    process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const DESKTOP_DIR = path.resolve(HERE, '..');
const RENDERER_INDEX = path.join(DESKTOP_DIR, 'renderer', 'dist', 'index.html');

// Everything below needs installed dependencies; nothing above did.
const require = createRequire(import.meta.url);
const { _electron: electron } = require('@playwright/test');
const {
    MAS_ASSETS, MAC_APP_STORE_SIZES, writePin,
} = await import(path.join(REPO_ROOT, 'tools/release/verify-listing-assets.mjs'));
// The same helpers the e2e suite drives this UI with, rather than a second
// opinion about how to unlock a wallet: plain functions over a Playwright
// page, which is what an Electron window is.
const {
    LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY,
    unlockedShell, dismissIntroCarousel, openSettings,
} = await import(path.join(REPO_ROOT, 'test/e2e/fixtures/wallet.js'));
const { LICENSE_VERSION } = await import(path.join(REPO_ROOT, 'packages/core/src/buildInfo.js'));
// The frozen inputs that make this capture REPEATABLE , read from
// the app's own module so the harness and the demo lane it drives cannot
// disagree about which mnemonic and which instant a capture runs at.
const {
    DEMO_CAPTURE_FLAG_KEY, DEMO_CAPTURE_CLOCK_MS,
} = await import(path.join(REPO_ROOT, 'packages/core/src/flows/demoCapture.js'));

const OUT_DIR = path.join(DESKTOP_DIR, 'docs', 'listing-assets');

function log(msg) {
    console.log(`[capture-listing-screenshots] ${msg}`);
}

function parseSize(argv) {
    const i = argv.indexOf('--size');
    if (i === -1) return { width: 1440, height: 900 };
    const m = /^(\d+)x(\d+)$/.exec(argv[i + 1] || '');
    if (!m) throw new Error(`--size wants WxH, got '${argv[i + 1]}'`);
    const size = { width: Number(m[1]), height: Number(m[2]) };
    if (!MAC_APP_STORE_SIZES.some((c) => c.width === size.width && c.height === size.height)) {
        throw new Error(`${size.width}x${size.height} is not an accepted macOS listing canvas; `
            + `App Store Connect takes ${MAC_APP_STORE_SIZES.map((c) => `${c.width}x${c.height}`).join(', ')}`);
    }
    return size;
}

/** PNG dimensions from the IHDR, so the assertion reads the FILE, not our intent. */
function pngSize(file) {
    const buf = fs.readFileSync(file);
    if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Flips Settings → Network to Mainnet.
 *
 * The demo wallet lands on Regtest by design (Onboarding.jsx registers chains
 * on all three networks so the user can look at any of them), and a public
 * store screenshot captioned "BTC · regtest" reads as a testing artifact
 * rather than the product. The extension capture makes the same move for the
 * same reason.
 *
 * This walk was impossible until 2026-08-07: every section of the desktop
 * Settings screen rendered "Settings unavailable" because the renderer's IPC
 * bridge was missing seventeen wrappers (row 105). The screenshots could not
 * have been taken without fixing that first, which is a fair summary of why
 * this row waited for that one.
 */
async function switchToMainnet(win) {
    await openSettings(win);
    const select = win.getByLabel('Active network');
    await select.waitFor({ state: 'visible', timeout: 30_000 });
    await select.selectOption('mainnet');
    // NetworkSection reloads the page on change; 'settings' is not in
    // RESUMABLE_VIEWS, so the reload lands back on Home.
    await win.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
    await unlockedShell(win).waitFor({ state: 'visible', timeout: 60_000 });
}

async function main() {
    if (!fs.existsSync(RENDERER_INDEX)) {
        throw new Error(`No renderer build at ${RENDERER_INDEX}. This drives the REAL app, so it `
            + 'needs the bundle the app loads. Run: pnpm --filter @xchain-wallet/desktop run build:renderer');
    }
    const size = parseSize(process.argv.slice(2));
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-desktop-listing-'));
    const app = await electron.launch({
        args: ['.', `--user-data-dir=${userDataDir}`],
        cwd: DESKTOP_DIR,
    });

    const produced = [];
    const missing = [];
    const pageErrors = [];

    try {
        const win = await app.firstWindow();
        win.on('pageerror', (err) => pageErrors.push(String(err)));
        await win.waitForLoadState('domcontentloaded');

        await win.addInitScript(([atKey, versionKey, version]) => {
            try {
                window.localStorage.setItem(atKey, new Date().toISOString());
                window.localStorage.setItem(versionKey, version);
            } catch { /* the license gate renders and the walk fails loudly */ }
        }, [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION]);
        // Capture mode: the demo lane takes the committed demo-only mnemonic
        // instead of rolling a new one, so the address in these images is the
        // same address on every capture .
        await win.addInitScript(([key]) => {
            try { window.localStorage.setItem(key, '1'); } catch { /* capture will differ, loudly */ }
        }, [DEMO_CAPTURE_FLAG_KEY]);
        // One frozen clock for the whole app: the fixtures date their rows
        // against `now` and the UI renders those dates as "3 minutes ago"
        // against its own, so freezing one without the other would put a
        // months-old wallet in a public listing. `setFixedTime` keeps timers
        // running, so the app still boots, unlocks and navigates normally.
        // Guarded rather than fatal: an Electron driver without the clock API
        // should still produce images, just not provably identical ones.
        try {
            await app.context().clock.setFixedTime(DEMO_CAPTURE_CLOCK_MS);
        } catch (err) {
            log(`WARNING: could not freeze the clock (${err?.message || err}); `
                + 'timestamps in these images will move between captures');
        }
        await win.reload();

        // The app's own default window is 420x720 (main/index.js). A listing
        // image has to be one of Apple's canvases, so the window is resized to
        // the target and the responsive layout paints its desktop form - which
        // is what a Mac user actually gets, since the window is resizable.
        await app.evaluate(({ BrowserWindow }, [w, h]) => {
            const target = BrowserWindow.getAllWindows()[0];
            target.setResizable(true);
            target.setContentSize(w, h);
        }, [size.width, size.height]);

        await dismissIntroCarousel(win);
        await win.getByRole('button', { name: 'Try in demo mode' }).click();
        await unlockedShell(win).waitFor({ state: 'visible', timeout: 120_000 });
        log('demo wallet created and unlocked');

        await switchToMainnet(win);
        log('active network switched to Mainnet');

        // Token icons load from their real (public, non-secret) URLs, and the
        // balance hero animates in. Demo mode fetches no chain data at all, so
        // this is the only thing worth settling for.
        await win.waitForTimeout(2000);

        const shots = [
            {
                name: 'screenshot-home.png',
                take: async () => {},
            },
            {
                name: 'screenshot-tokens.png',
                take: async () => {
                    await win.getByRole('tab', { name: 'Tokens' }).click();
                    await win.waitForTimeout(1500);
                },
            },
            {
                name: 'screenshot-settings.png',
                take: async () => {
                    await openSettings(win);
                    await win.getByLabel('Active network').waitFor({ state: 'visible', timeout: 30_000 });
                    await win.waitForTimeout(800);
                },
            },
        ];

        for (const shot of shots) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await shot.take();
                const file = path.join(OUT_DIR, shot.name);
                // eslint-disable-next-line no-await-in-loop
                await win.screenshot({ path: file });
                const actual = pngSize(file);
                if (!actual || actual.width !== size.width || actual.height !== size.height) {
                    throw new Error(`captured ${actual ? `${actual.width}x${actual.height}` : 'an unreadable PNG'}, `
                        + `wanted ${size.width}x${size.height}. A window that did not take the size it was `
                        + 'given produces a listing image App Store Connect refuses at upload.');
                }
                produced.push(shot.name);
                log(`${shot.name}: ${actual.width}x${actual.height}`);
            } catch (err) {
                missing.push(`${shot.name}: ${err && err.message ? err.message.split('\n')[0] : err}`);
            }
        }

        if (pageErrors.length > 0) {
            missing.push(`the renderer raised page errors while being captured: ${pageErrors.join(' | ')}`);
        }
    } finally {
        await app.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }

    log(`produced: ${produced.join(', ') || '(none)'}`);

    // Only a COMPLETE capture re-pins, for the reason the extension script
    // spells out: a partial one leaves one asset's old bytes beside two new
    // ones, and pinning that set records a build none of them all came from.
    if (missing.length === 0 && produced.length === MAS_ASSETS.length) {
        const pin = writePin({ how: 'capture', set: 'mas' });
        log(`pinned to ${pin.capturedFrom.commit.slice(0, 8)} (v${pin.capturedFrom.version}): `
            + 'packages/desktop/docs/listing-assets/capture-pin.json');
        return 0;
    }

    for (const m of missing) console.error(`[capture-listing-screenshots] FAILED: ${m}`);
    console.error('[capture-listing-screenshots] capture was INCOMPLETE, so the pin was NOT updated. '
        + 'The assets on disk are now a mixture of builds; re-run until it produces all '
        + `${MAS_ASSETS.length}.`);
    return 1;
}

process.exit(await main());
