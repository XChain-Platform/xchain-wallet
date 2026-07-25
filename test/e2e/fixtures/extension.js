// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MV3 extension venue (, spec §8.6 scenarios 2 and 5).
//
// WHY THE EXTENSION AND NOT THE WEB SHELL
//
// Two of §8.6's scenarios cannot be expressed in the web shell at all,
// and that is a property of the PRODUCT, not of the test:
//
//   - The two-window same-balance race (§4.7). `packages/web/hostBridge.js`
//     builds a `createBackgroundHost` PER PAGE, and the reservation ledger
//     lives inside that host, so two web tabs get two independent ledgers
//     and no cross-window protection whatsoever. The guarantee only exists
//     where ONE host serves many windows, which is the MV3 service worker
//     (the shape `dfc6a20` deliberately chose).
//   - SW-kill rehydration (§5.4). There is no service worker to kill in a
//     web page.
//
// So this venue is where those two guarantees are actually testable.
//
// HOW IT DIFFERS FROM THE OTHER TWO CONFIGS
//
// There is no `webServer`: the extension IS the artifact, loaded unpacked
// from `packages/extension/dist`. Chromium only loads extensions in a
// PERSISTENT context, so every spec here shares one profile directory and
// the context is built per test rather than by Playwright's default
// browser fixture.
//
// `--disable-web-security` is required for the same reason as the regtest
// preview config: the manifest declares NO `host_permissions`, so the
// service worker's fetches are ordinary CORS-governed requests, and the
// regtest explorer sends no CORS headers. That is a property of the local
// venue, not of the wallet - production explorers answer with permissive
// headers, which is why the shipped extension needs no host permission.

import { test as base, chromium, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY } from './wallet.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIST = path.resolve(HERE, '../../../packages/extension/dist');

/**
 * Persistent-context fixture that loads the built extension and exposes
 * its id plus a helper for opening additional popup windows.
 */
export const test = base.extend({
    context: async ({}, use) => {
        if (!fs.existsSync(path.join(EXTENSION_DIST, 'manifest.json'))) {
            throw new Error(
                `Extension not built at ${EXTENSION_DIST}. Run: pnpm -C packages/extension build`,
            );
        }
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-ext-e2e-'));
        const context = await chromium.launchPersistentContext(userDataDir, {
            // Chromium loads extensions only in a headed context.
            headless: false,
            viewport: { width: 400, height: 700 },
            args: [
                `--disable-extensions-except=${EXTENSION_DIST}`,
                `--load-extension=${EXTENSION_DIST}`,
                // See the header: the manifest declares no host_permissions,
                // and the regtest explorer sends no CORS headers.
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
        });
        await use(context);
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    },

    extensionId: async ({ context }, use) => {
        let [sw] = context.serviceWorkers();
        if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
        await use(new URL(sw.url()).host);
    },

    // The first popup, already past the license gate. Seeded the same way
    // the web fixture does it and for the same reason: the gate is not what
    // these specs test, and clicking through it would couple them to legal
    // copy that changes for legal reasons.
    page: async ({ context, extensionId }, use) => {
        await context.addInitScript(
            ([atKey, versionKey, version]) => {
                try {
                    window.localStorage.setItem(atKey, new Date().toISOString());
                    window.localStorage.setItem(versionKey, version);
                } catch { /* gate renders and the spec fails loudly */ }
            },
            [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
        );
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup.html`);
        await use(page);
    },
});

export { expect };

/**
 * Opens ANOTHER popup window on the same extension.
 *
 * This is the whole point of the venue: both windows are served by the
 * one service worker, so they share the §4.7 reservation ledger. Two web
 * tabs would not.
 */
export async function openSecondPopup(context, extensionId) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    return page;
}

/**
 * Kills the MV3 service worker the way Chrome does on idle.
 *
 * Driven over CDP because Playwright exposes no "stop this worker" API.
 * `chrome.runtime.reload()` is NOT equivalent: it tears down the whole
 * extension including open popups, which is a restart, not the eviction
 * §5.4 is about (Chrome reclaiming an idle worker while the user is still
 * reading the confirm screen).
 */
export async function killServiceWorker(context, page) {
    const session = await context.newCDPSession(page);
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    await session.detach();
}

/** Waits for a service worker to be running again after a kill. */
export async function waitForServiceWorker(context, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (context.serviceWorkers().length > 0) return context.serviceWorkers()[0];
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('service worker never came back after the kill');
}
