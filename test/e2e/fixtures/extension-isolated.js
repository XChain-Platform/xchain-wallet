// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// The extension fixture WITHOUT the CORS workaround, for specs that drive a
// dApp-originated approval.
//
// fixtures/extension.js launches Chromium with `--disable-web-security` and
// `--disable-features=IsolateOrigins,site-per-process`, because the regtest
// explorer sends no CORS headers and the manifest declares no host_permissions.
// Those flags have a side effect that matters here: with site isolation off,
// the APPROVAL WINDOW's renderer does not receive the extension bindings, so
// `chrome.runtime.sendMessage` is undefined and every approval page renders
// "chrome.runtime.sendMessage unavailable" instead of a decision. Measured
// both ways: identical build, identical profile, the only difference being
// those two flags.
//
// No existing spec caught this because none of them drive an approval that
// ORIGINATES FROM A PAGE - the three .extension.spec.js files all drive the
// popup, which keeps its bindings either way.
//
// A spec that never touches a chain does not need the CORS workaround, so this
// fixture drops it. Anything that talks to the regtest explorer must keep using
// fixtures/extension.js.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { test as base, expect, chromium } from '@playwright/test';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY } from './wallet.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = path.resolve(HERE, '../../../packages/extension/dist');

export const test = base.extend({
    context: async ({}, use) => {
        if (!fs.existsSync(path.join(EXTENSION_DIST, 'manifest.json'))) {
            throw new Error(`Extension not built at ${EXTENSION_DIST}. Run: pnpm -C packages/extension build`);
        }
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-ext-iso-e2e-'));
        const context = await chromium.launchPersistentContext(userDataDir, {
            // Chromium loads extensions only in a headed context.
            headless: false,
            viewport: { width: 400, height: 700 },
            args: [
                `--disable-extensions-except=${EXTENSION_DIST}`,
                `--load-extension=${EXTENSION_DIST}`,
                // Deliberately NO --disable-web-security and NO
                // --disable-features=IsolateOrigins: see the header.
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

    page: async ({ context, extensionId }, use) => {
        // Pre-accept the licence gate: it is not what these specs test.
        await context.addInitScript(
            ([atKey, versionKey, version]) => {
                try {
                    window.localStorage.setItem(atKey, new Date().toISOString());
                    window.localStorage.setItem(versionKey, version);
                } catch { /* the gate renders and the spec fails loudly */ }
            },
            [LICENSE_ACCEPTED_AT_KEY, LICENSE_ACCEPTED_VERSION_KEY, LICENSE_VERSION],
        );
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup.html`);
        await use(page);
    },
});

export { expect };
