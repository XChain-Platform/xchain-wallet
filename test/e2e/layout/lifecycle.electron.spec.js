// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Window lifecycle in the real desktop app on the machine it runs on: close
// keeps the app running, the dock (macOS) brings the window back, a second
// window closes for real, quit with nothing pending exits, and quit while a
// wallet message is still being handled waits, shows the window, and exits on
// the next request once the message settles. Every launch goes through
// fixtures/electron.js, which keeps the app off every non-local host.
//
//     pnpm --filter @xchain-wallet/desktop build:renderer
//     pnpm --dir test/e2e exec playwright test --config playwright.layout-desktop.config.js lifecycle

import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import {
    FIRST_WINDOW_TEXT, GUARD_ON_TEXT, closeElectron, launchGuardedElectron, readNetworkGuard,
} from '../fixtures/electron.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const desktopDir = join(repo, 'packages', 'desktop');
const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));

async function launch() {
    const app = await launchGuardedElectron(electron, {
        executablePath: requireFromDesktop('electron'),
        args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'xc-lifecycle-'))}`, '--use-mock-keychain'],
        cwd: desktopDir,
    });
    await app.firstWindow();
    const guard = await readNetworkGuard(app);
    const on = guard.lines.findIndex((l) => l.startsWith(GUARD_ON_TEXT));
    expect(on, `guard lines: ${JSON.stringify(guard.lines)}`).toBe(0);
    expect(guard.lines.indexOf(FIRST_WINDOW_TEXT), 'the guard is on before the first window').toBeGreaterThan(on);
    return app;
}

const windowState = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .map((w) => ({ id: w.id, visible: w.isVisible(), destroyed: w.isDestroyed() })));

/** Ask the app to quit on its next tick and report whether it exited in time. */
async function quitAndWait(app, timeout) {
    const closed = app.waitForEvent('close', { timeout }).then(() => true, () => false);
    await app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 50); }).catch(() => {});
    return closed;
}

test('close, reopen, a second window, and a quit with nothing pending', async () => {
    test.setTimeout(3 * 60 * 1000);
    const app = await launch();
    let exited = false;
    try {
        // The window shows once its renderer is ready to paint.
        await expect.poll(async () => (await windowState(app))[0]?.visible, { timeout: 30_000 }).toBe(true);
        const [first] = await windowState(app);

        // The close button on the last window keeps the app and its window.
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        await expect.poll(() => windowState(app)).toEqual([{ ...first, visible: false }]);

        // A dock click reaches the app as 'activate'.
        await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
        await expect.poll(() => windowState(app), { timeout: 15_000 }).toEqual([first]);

        // File > New Window, then close the new one: it goes away for real.
        await app.evaluate(({ Menu }) => {
            const find = (items) => {
                for (const item of items) {
                    if (/new window/i.test(item.label)) return item;
                    const inner = item.submenu ? find(item.submenu.items) : null;
                    if (inner) return inner;
                }
                return null;
            };
            find(Menu.getApplicationMenu().items).click();
        });
        await expect.poll(async () => (await windowState(app)).length, { timeout: 15_000 }).toBe(2);
        await app.evaluate(({ BrowserWindow }) => {
            const wins = BrowserWindow.getAllWindows();
            wins.find((w) => w.id !== Math.min(...wins.map((x) => x.id))).close();
        });
        await expect.poll(() => windowState(app), { timeout: 15_000 }).toEqual([first]);

        exited = await quitAndWait(app, 20_000);
        expect(exited, 'quit with nothing pending exits').toBe(true);
    } finally {
        if (!exited) await closeElectron(app);
    }
});

test('quit waits for a wallet message in flight, then exits on the next request', async () => {
    test.setTimeout(3 * 60 * 1000);
    const app = await launch();
    let exited = false;
    try {
        // Stands in for a send between signing and saving: the wallet message
        // handler counts the message the moment it is called, and the quit
        // request lands while that call is still outstanding.
        const deferred = await app.evaluate(({ app: electronApp, BrowserWindow, ipcMain }) => {
            const handler = ipcMain._invokeHandlers?.get('xchain-wallet:message');
            if (typeof handler !== 'function') return { error: 'no wallet message handler' };
            const win = BrowserWindow.getAllWindows()[0];
            win.hide();
            let quitEventDefaultPrevented = null;
            electronApp.once('before-quit', (event) => {
                setImmediate(() => { quitEventDefaultPrevented = event.defaultPrevented; });
            });
            const pending = handler(
                { senderFrame: win.webContents.mainFrame, sender: win.webContents },
                { type: 'session.status', request: {} },
            );
            electronApp.quit();
            globalThis.__lifecyclePending = pending;
            return new Promise((done) => setTimeout(() => done({
                quitEventDefaultPrevented,
                visible: win.isVisible(),
            }), 1_000));
        });
        expect(deferred.error).toBeUndefined();
        expect(deferred.quitEventDefaultPrevented, 'quit waits for the message').toBe(true);
        expect(deferred.visible, 'and the window comes back').toBe(true);

        const settled = await app.evaluate(async () => {
            const response = await globalThis.__lifecyclePending;
            return Boolean(response && typeof response === 'object');
        });
        expect(settled).toBe(true);

        exited = await quitAndWait(app, 20_000);
        expect(exited, 'a second quit exits once nothing is pending').toBe(true);
    } finally {
        if (!exited) await closeElectron(app);
    }
});
