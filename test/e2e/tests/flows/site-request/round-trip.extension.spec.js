// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { HOST_BLOCK_ARG } from '../../../host-block.js';
import { providerReady } from '../../../../../packages/connect/src/transportPick.js';
import { EXTENSION_DIST, expect, test } from './round-trip.helpers.js';

test.describe('extension on the test-dapp', () => {
    test('the extension provider is injected on the page and the connect client uses it', async ({ dapp }, testInfo) => {
        expect(existsSync(resolve(EXTENSION_DIST, 'manifest.json')), 'packages/extension/dist is not built').toBe(true);

        const profile = mkdtempSync(resolve(tmpdir(), 'site-request-ext-'));
        const context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium',
            headless: true,
            ignoreHTTPSErrors: true,
            args: [`--disable-extensions-except=${EXTENSION_DIST}`, `--load-extension=${EXTENSION_DIST}`, HOST_BLOCK_ARG],
        });
        try {
            const page = await context.newPage();
            await page.goto(`${dapp.secureOrigin}/`);
            await expect.poll(() => page.evaluate(() => typeof window.xchain), { timeout: 30_000 }).toBe('object');
            const provider = await page.evaluate(() => ({ version: window.xchain.version }));
            expect(typeof provider.version).toBe('string');
            expect(providerReady(provider), `the injected provider reports ${provider.version}, below the connect client minimum`).toBe(true);

            await page.evaluate(() => {
                window.__opened = [];
                window.__providerTraffic = [];
                window.open = (url) => { window.__opened.push(String(url)); return {}; };
                window.addEventListener('message', (event) => {
                    const data = event.data;
                    if (event.source !== window || !data) return;
                    if (data.source === 'xchain-inject' || data.source === 'xchain-inject-response') {
                        window.__providerTraffic.push({ source: data.source, id: data.id, type: data.type, ok: data.ok });
                    }
                });
            });
            await page.getByRole('button', { name: 'Login with XChain' }).click();
            await expect.poll(
                () => page.evaluate(() => window.__providerTraffic.map((entry) => entry.source)),
                { timeout: 30_000 },
            ).toEqual(['xchain-inject', 'xchain-inject-response']);
            const traffic = await page.evaluate(() => window.__providerTraffic);
            expect(traffic[0].type, 'the page asked the provider to sign in').toMatch(/sign.?in|login/i);
            expect(traffic[1].id, 'the provider answered the same request').toBe(traffic[0].id);
            await expect.poll(
                () => page.locator('#response').textContent(),
                { timeout: 30_000 },
            ).toMatch(/"error": "WALLET_LOCKED"/);
            await expect(page.locator('[data-pick]')).toHaveCount(0);
            expect(await page.evaluate(() => window.__opened)).toEqual([]);
            testInfo.annotations.push({ type: 'extension', description: EXTENSION_DIST });
        } finally {
            await context.close();
        }
    });
});
