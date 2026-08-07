// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// THE DESKTOP APP LAUNCHES AND ACTUALLY RENDERS SOMETHING.
//
// Every other desktop smoke in this directory reads source, config or
// packaging metadata. Not one of them had ever started the app and looked at
// it, and that gap shipped: measured 2026-08-07, the renderer died at module
// scope with `ReferenceError: Buffer is not defined` and the window was BLANK
// WHITE. xchain-sdk is CJS and bitcoinjs-lib touches `Buffer.alloc(1)` while
// its module is still evaluating; the window runs `nodeIntegration: false`,
// `contextIsolation: true`, `sandbox: true`, and the preload exposes no
// Buffer. packages/web and packages/extension both carry
// vite-plugin-node-polyfills for exactly this; packages/desktop carried none.
// The same bytes are inside the shipped v0.336.0 `.deb`.
//
// The spec's frontier row 25 said "the packaged desktop app starts now". It
// did start - a process ran and a window appeared. Nothing asked what was in
// the window, so "starts" and "works" were the same green for four days.
//
// This asserts the weakest useful property, deliberately: the React tree
// MOUNTED and the document says something. A screenshot comparison would be
// brittle; a blank page is not a judgement call.

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktopDir = join(wsRoot, 'packages', 'desktop');
const rendererIndex = join(desktopDir, 'renderer', 'dist', 'index.html');

if (!existsSync(rendererIndex)) {
    console.log('SKIP: desktop-renders smoke - no renderer build at '
        + `${rendererIndex}. This gate launches the REAL app, so it needs the `
        + 'bundle the app loads. Run `pnpm --filter @xchain-wallet/desktop run '
        + 'build:renderer` first.');
    process.exit(0);
}

// Electron needs a display server. On a headless Linux runner without xvfb
// the launch itself fails, which is an environment fact and not a verdict on
// the app - so it is named out loud rather than reported as a pass.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.log('SKIP: desktop-renders smoke - Electron needs a display and this '
        + 'host has neither DISPLAY nor WAYLAND_DISPLAY. Run under xvfb-run to '
        + 'include this gate.');
    process.exit(0);
}

const { _electron: electron } = await import('@playwright/test');

const app = await electron.launch({ args: ['.'], cwd: desktopDir });
const pageErrors = [];
let win;
try {
    win = await app.firstWindow();
    win.on('pageerror', (err) => pageErrors.push(String(err)));
    await win.waitForLoadState('domcontentloaded');

    // The mount is asynchronous, so poll rather than sleep a fixed amount:
    // a fixed wait is either flaky or slow, and this failure mode is
    // permanent - a blank page stays blank.
    const deadline = Date.now() + 20000;
    let html = '';
    while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        html = await win.evaluate(
            () => (document.getElementById('root') || document.body).innerHTML,
        );
        if (html.length > 200) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 250); });
    }

    assert.ok(
        html.length > 200,
        'the desktop renderer mounted nothing: #root is '
        + `${html.length} characters after 20s, which is the blank white window `
        + `a user would see. Page errors: ${pageErrors.join(' | ') || '(none)'}`,
    );

    const text = await win.evaluate(() => document.body.innerText);
    assert.ok(
        text.trim().length > 0,
        'the desktop app rendered a DOM with no readable text at all; '
        + `page errors: ${pageErrors.join(' | ') || '(none)'}`,
    );

    // A page error at module scope is how the blank window happened, and it
    // is worth failing on even if something else managed to paint: it means a
    // module the app depends on never finished evaluating.
    assert.deepEqual(
        pageErrors,
        [],
        `the desktop renderer raised page errors while booting: ${pageErrors.join(' | ')}`,
    );
} finally {
    await app.close();
}

console.log(
    'OK: desktop-renders smoke (the real Electron app launches, the renderer '
    + 'mounts a non-empty tree with readable text, and boots with no page '
    + 'errors - the gate that would have caught the blank white window)',
);
