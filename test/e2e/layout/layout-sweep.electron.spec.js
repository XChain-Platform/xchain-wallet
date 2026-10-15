// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep in the macOS (and Linux/Windows) desktop app: the real
// Electron shell, at several window sizes from its minimum up.
//
// Isolation, the same way test/smoke/shells/desktop-renders.smoke.js does it:
// a throwaway --user-data-dir per run, and the wallet's own demo mode instead
// of creating a vault, so a run never touches a real install's data or the
// OS keychain. Needs a renderer build:
//
//     pnpm --filter @xchain-wallet/desktop build:renderer

import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import { createSweep, measureControlRows, measureRulings } from './sweep.js';
import { launchGuardedElectron } from '../fixtures/electron.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const desktopDir = join(repo, 'packages', 'desktop');
// LAYOUT_SWEEP_OUT sends the lines and screenshots somewhere else.
const OUT_ROOT = process.env.LAYOUT_SWEEP_OUT || join(repo, 'tmp', 'layout-sweep');

// The window sizes: the app's minimum, its default, a mid-size and a large
// one. The desktop shell is a resizable phone-first layout, so the sizes
// between are where panels have been seen to misbehave.
// LAYOUT_SIZES="1920x1080,1280x800" picks others, e.g. a large monitor.
const SIZES = process.env.LAYOUT_SIZES
    ? process.env.LAYOUT_SIZES.split(',').map((s) => s.split('x').map(Number))
    : [
        [360, 600],
        [420, 720],
        [900, 700],
        [1280, 800],
    ];

for (const [width, height] of SIZES) {
    test(`desktop layout sweep ${width}x${height}`, async () => {
        test.setTimeout(75 * 60 * 1000);
        const venue = `macos-desktop-${width}x${height}`;
        const userDataDir = mkdtempSync(join(tmpdir(), 'xc-layout-sweep-'));
        const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
        const app = await launchGuardedElectron(electron, {
            executablePath: requireFromDesktop('electron'),
            args: ['.', `--user-data-dir=${userDataDir}`],
            cwd: desktopDir,
        });
        try {
            const page = await app.firstWindow();
            // The display is recorded with the size the window really got: a
            // request larger than the work area is clamped by the OS, and a
            // clamped run must not be read as the size it asked for.
            const sized = await app.evaluate(({ BrowserWindow, screen }, [w, h]) => {
                const win = BrowserWindow.getAllWindows()[0];
                win.setMinimumSize(Math.min(w, 360), Math.min(h, 600));
                win.setContentSize(w, h);
                const [cw, ch] = win.getContentSize();
                return { workArea: screen.getPrimaryDisplay().workArea, content: { width: cw, height: ch } };
            }, [width, height]);
            console.log(`window ${width}x${height}: content ${sized.content.width}x${sized.content.height}, work area ${sized.workArea.width}x${sized.workArea.height}`);

            // No fixture seeds the licence acceptance here, so take the
            // gate the way a user does whenever it appears.
            let sweepRef = null;
            let gateMeasured = false;
            const restart = async () => {
                await page.reload();
                const accept = page.getByRole('button', { name: 'Accept and continue' });
                const welcome = page.getByRole('button', { name: 'Skip' })
                    .or(page.getByRole('button', { name: 'Create new wallet' }));
                await accept.or(welcome).first().waitFor({ state: 'visible', timeout: 60_000 });
                if (await accept.isVisible()) {
                    if (sweepRef && !gateMeasured) {
                        gateMeasured = true;
                        await sweepRef.measure('licence gate');
                    }
                    // As a user must: scroll the terms to the end, which is
                    // what enables the checkbox, then agree and accept.
                    await page.getByRole('region', { name: 'License terms' }).or(page.getByLabel('License terms')).first()
                        .evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
                    await page.getByRole('checkbox').first().check();
                    await accept.click();
                    await welcome.first().waitFor({ state: 'visible', timeout: 60_000 });
                }
            };

            const outDir = join(OUT_ROOT, venue);
            const sweep = createSweep(page, {
                venue,
                outDir,
                restart,
                onScreen: async (p) => ({
                    rulings: await p.evaluate(measureRulings),
                    controlRows: await p.evaluate(measureControlRows),
                }),
            });
            sweepRef = sweep;
            await sweep.onboarding({ demo: true });
            await sweep.unlocked();
            // Check harness coverage, not findings: the walk wrote at least one parseable screen line.
            const measured = readFileSync(join(outDir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
            expect(measured.length, 'harness coverage: the sweep measured no screen').toBeGreaterThan(0);
        } finally {
            await app.close();
        }
    });
}
