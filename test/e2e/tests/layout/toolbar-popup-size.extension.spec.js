// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The real toolbar popup, opened through chrome.action.openPopup(), measured
// over CDP. A popup.html tab cannot stand in for it: only the toolbar popup
// sizes itself from its content, and a document that loses its fixed size
// there collapses to Chrome's 25x25 minimum.
//
// Playwright does not surface the toolbar popup as a Page, so the spec finds
// its target in the DevTools target list (port from DevToolsActivePort) and
// drives it over the target's websocket. `--screen-info` gives headless
// Chromium a screen tall enough that the popup is not clipped below 600px.
//
// The failing case prepends a throw to the shared core chunk of a copy of the
// build, the same import-time failure that left the popup an empty square:
// popup-size.js must still size it and show the load-failure notice.

import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { HOST_BLOCK_ARG } from '../../host-block.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..', '..');
const DIST = join(repo, 'packages', 'extension', 'dist');
const WIDTH = 360;
const HEIGHT = 600;
const FORCED_FAILURE = 'simulated import-time failure';

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

function requireBuild() {
    let files;
    try {
        files = readdirSync(DIST);
    } catch {
        files = [];
    }
    if (!files.includes('manifest.json') || !files.includes('popup-size.js')) {
        throw new Error(`extension not built at ${DIST}; run: pnpm -C packages/extension build`);
    }
}

/** A copy of the build whose shared core chunk throws while it is imported. */
function brokenBuild(outDir) {
    const dir = join(outDir, 'ext-import-failure');
    cpSync(DIST, dir, { recursive: true });
    const chunks = join(dir, 'chunks');
    const core = readdirSync(chunks).find((name) => /^core-.*\.js$/.test(name));
    if (!core) throw new Error(`no core chunk in ${chunks}`);
    const file = join(chunks, core);
    writeFileSync(file, `throw new Error(${JSON.stringify(FORCED_FAILURE)});\n${readFileSync(file, 'utf8')}`);
    return dir;
}

async function launch(extensionDir, outDir, name) {
    const profile = join(outDir, `profile-${name}`);
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 1000 },
        args: [
            `--disable-extensions-except=${extensionDir}`,
            `--load-extension=${extensionDir}`,
            '--remote-debugging-port=0',
            '--screen-info={1600x1200}',
            '--window-size=1280,1000',
            HOST_BLOCK_ARG,
        ],
    });
    const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    return { context, port, worker, origin: `chrome-extension://${new URL(worker.url()).host}` };
}

function connect(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const opened = new Promise((done, fail) => {
        socket.addEventListener('open', done, { once: true });
        socket.addEventListener('error', fail, { once: true });
    });
    const waiting = new Map();
    let nextId = 0;
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && waiting.has(message.id)) {
            waiting.get(message.id)(message);
            waiting.delete(message.id);
        }
    });
    socket.addEventListener('close', () => {
        for (const done of waiting.values()) done({ error: { message: 'target closed' } });
        waiting.clear();
    });
    const send = async (method, params = {}) => {
        await opened;
        nextId += 1;
        const id = nextId;
        return new Promise((done) => {
            waiting.set(id, done);
            socket.send(JSON.stringify({ id, method, params }));
        });
    };
    const evaluate = async (expression) => {
        const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (reply.error) throw new Error(reply.error.message);
        if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
        return reply.result.result.value;
    };
    return { evaluate, close: () => socket.close() };
}

/** Open the toolbar popup from the service worker and attach to it over CDP. */
async function openToolbarPopup({ context, port, worker }) {
    const tab = context.pages()[0] || await context.newPage();
    await tab.bringToFront();
    const opened = await worker.evaluate(async () => {
        try {
            const focused = await chrome.windows.getLastFocused();
            await chrome.action.openPopup({ windowId: focused.id });
            return 'ok';
        } catch (error) {
            return String(error && error.message);
        }
    });
    expect(opened, 'chrome.action.openPopup()').toBe('ok');
    let target = null;
    for (let i = 0; i < 400 && !target; i += 1) {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((entry) => entry.type === 'page' && /\/popup\.html(\?|$)/.test(entry.url));
        if (!target) await sleep(25);
    }
    if (!target) throw new Error('the toolbar popup never appeared in the DevTools target list');
    return connect(target.webSocketDebuggerUrl);
}

const MEASURE = `(() => {
    const box = (el) => el ? [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)] : null;
    const failure = document.querySelector('[data-xc-boot-failure]');
    return {
        viewport: [innerWidth, innerHeight],
        html: box(document.documentElement),
        popupClass: document.documentElement.classList.contains('xchain-toolbar-popup'),
        bootScreen: Boolean(document.querySelector('#xchain-popup-root .xc-boot')),
        failure: failure ? {
            box: box(failure),
            notice: failure.querySelector('[role="alert"]')?.textContent || '',
            details: failure.querySelector('details code')?.textContent || '',
            summary: failure.querySelector('details summary')?.textContent || '',
            buttons: [...failure.querySelectorAll('button')].map((b) => b.textContent),
        } : null,
    };
})()`;

async function sampleUntil(popup, done) {
    let sample = null;
    for (let i = 0; i < 120; i += 1) {
        sample = await popup.evaluate(MEASURE);
        if (done(sample)) return sample;
        await sleep(100);
    }
    return sample;
}

test.describe('toolbar popup size', () => {
    test.setTimeout(3 * 60 * 1000);

    test('a healthy popup opens at 360x600 and mounts the app', async ({}, testInfo) => {
        requireBuild();
        const venue = await launch(DIST, testInfo.outputDir, 'healthy');
        try {
            const popup = await openToolbarPopup(venue);
            const first = await popup.evaluate(MEASURE);
            expect(first.popupClass, 'sized from the first sample').toBe(true);
            const mounted = await sampleUntil(popup, (s) => !s.bootScreen);
            expect(mounted.bootScreen, 'the app replaced the boot screen').toBe(false);
            expect(mounted.viewport).toEqual([WIDTH, HEIGHT]);
            expect(mounted.html).toEqual([WIDTH, HEIGHT]);
            expect(mounted.failure, 'no load-failure notice in a healthy popup').toBeNull();
            popup.close();
        } finally {
            await venue.context.close();
        }
    });

    test('an import-time failure keeps 360x600 and shows the load-failure notice', async ({}, testInfo) => {
        requireBuild();
        const venue = await launch(brokenBuild(testInfo.outputDir), testInfo.outputDir, 'failure');
        try {
            const popup = await openToolbarPopup(venue);
            const shown = await sampleUntil(popup, (s) => Boolean(s.failure));
            expect(shown.viewport, 'not the 25x25 collapse').toEqual([WIDTH, HEIGHT]);
            expect(shown.html).toEqual([WIDTH, HEIGHT]);
            expect(shown.popupClass).toBe(true);
            expect(shown.failure.box).toEqual([WIDTH, HEIGHT]);
            expect(shown.failure.notice).toContain("XChain Wallet couldn't start.");
            expect(shown.failure.summary).toBe('Technical details');
            expect(shown.failure.details).toContain(FORCED_FAILURE);
            expect(shown.failure.buttons).toEqual(['Reload', 'Open in tab']);

            const tabOpened = venue.context.waitForEvent('page', {
                predicate: (page) => page.url() === `${venue.origin}/popup.html`,
                timeout: 30_000,
            });
            await popup.evaluate(`[...document.querySelectorAll('[data-xc-boot-failure] button')]
                .find((b) => b.textContent === 'Open in tab').click()`).catch(() => {});
            const tab = await tabOpened;
            expect(tab.url()).toBe(`${venue.origin}/popup.html`);
            popup.close();
        } finally {
            await venue.context.close();
        }
    });

    test('popup.html in a tab gets no popup size and offers only Reload', async ({}, testInfo) => {
        requireBuild();
        const venue = await launch(brokenBuild(testInfo.outputDir), testInfo.outputDir, 'tab');
        try {
            const page = await venue.context.newPage();
            await page.goto(`${venue.origin}/popup.html`);
            await page.locator('[data-xc-boot-failure]').waitFor({ state: 'visible', timeout: 30_000 });
            const shown = await page.evaluate(MEASURE);
            expect(shown.popupClass, 'a tab keeps the full document width').toBe(false);
            expect(shown.html[0]).toBe(1280);
            expect(shown.failure.buttons).toEqual(['Reload']);
            expect(shown.failure.details).toContain(FORCED_FAILURE);
        } finally {
            await venue.context.close();
        }
    });
});
