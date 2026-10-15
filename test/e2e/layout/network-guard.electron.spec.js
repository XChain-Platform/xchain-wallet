// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop test network guard, end to end in the real Electron app.
//
// Two desktop test runs reached hub.xchain.io and explorer.xchain.io because
// their network block rode in NODE_OPTIONS, which electron.launch drops. The
// first test proves the guard on a reserved .invalid host with the app's
// probe mode, which exits before any window exists, so nothing here touches
// a mainnet service unless that proof has passed. The second launches the
// app the way every desktop test does and checks that the guard came up
// before the first window and refuses hub.xchain.io on all three egress
// paths: Node fetch, Node https and Chromium.
//
//     pnpm --filter @xchain-wallet/desktop build:renderer
//     pnpm --dir test/e2e exec playwright test --config playwright.layout-desktop.config.js network-guard

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron } from '@playwright/test';
import {
    FIRST_WINDOW_TEXT,
    GUARD_ON_TEXT,
    PROBE_SWITCH,
    guardedLaunchOptions,
    launchGuardedElectron,
    readNetworkGuard,
} from '../fixtures/electron.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..', '..', '..');
const desktopDir = join(repo, 'packages', 'desktop');
const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
const REFUSAL_CODE = 'ERR_XCHAIN_NETWORK_GUARD';

test.describe.configure({ mode: 'serial' });

test('probe mode refuses every egress path and exits before any window', async () => {
    test.setTimeout(3 * 60 * 1000);
    const launch = guardedLaunchOptions({
        args: [
            desktopDir,
            `--${PROBE_SWITCH}`,
            `--user-data-dir=${mkdtempSync(join(tmpdir(), 'xc-network-guard-probe-'))}`,
            '--use-mock-keychain',
        ],
    });
    const run = spawnSync(requireFromDesktop('electron'), launch.args, {
        env: launch.env,
        encoding: 'utf8',
        timeout: 2 * 60 * 1000,
    });
    const guardLines = `${run.stdout}\n${run.stderr}`.split('\n').filter((l) => l.startsWith('[xchain] network guard'));
    expect(guardLines[0], 'the guard announces itself first').toContain(GUARD_ON_TEXT);
    expect(guardLines).toContain('[xchain] network guard probe node fetch: refused');
    expect(guardLines).toContain('[xchain] network guard probe node https: refused');
    expect(guardLines).toContain('[xchain] network guard probe chromium net.fetch: refused');
    expect(guardLines.at(-1)).toBe('[xchain] network guard probe PASS');
    expect(guardLines, 'probe mode opens no window').not.toContain(FIRST_WINDOW_TEXT);
    expect(run.status).toBe(0);
});

test('the guard is on before the first window and refuses hub.xchain.io', async () => {
    test.setTimeout(3 * 60 * 1000);
    const app = await launchGuardedElectron(electron, {
        executablePath: requireFromDesktop('electron'),
        args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'xc-network-guard-'))}`, '--use-mock-keychain'],
        cwd: desktopDir,
    });
    try {
        await app.firstWindow();
        const startup = await readNetworkGuard(app);
        const on = startup.lines.findIndex((l) => l.startsWith(GUARD_ON_TEXT));
        const filtering = startup.lines.findIndex((l) => l.includes('network guard filtering'));
        const firstWindow = startup.lines.indexOf(FIRST_WINDOW_TEXT);
        expect(on, `guard lines: ${JSON.stringify(startup.lines)}`).toBe(0);
        expect(filtering, 'the Chromium filter is attached after the startup line').toBeGreaterThan(on);
        expect(firstWindow, 'and before the first window').toBeGreaterThan(filtering);

        const outcome = await app.evaluate(async ({ net }) => {
            const https = process.getBuiltinModule('node:https');
            const attempt = async (run) => {
                try {
                    await run();
                    return 'reached';
                } catch (err) {
                    return String(err?.cause?.code ?? err?.code ?? err?.message ?? err);
                }
            };
            return {
                nodeFetch: await attempt(() => fetch('https://hub.xchain.io/')),
                nodeHttps: await attempt(() => new Promise((ok, fail) => {
                    https.get('https://hub.xchain.io/', (res) => { res.resume(); ok(res); }).on('error', fail);
                })),
                chromium: await attempt(() => net.fetch('https://hub.xchain.io/')),
            };
        });
        expect(outcome.nodeFetch).toBe(REFUSAL_CODE);
        expect(outcome.nodeHttps).toBe(REFUSAL_CODE);
        expect(outcome.chromium).toMatch(/ERR_BLOCKED_BY_CLIENT/);

        const after = await readNetworkGuard(app);
        expect(after.refusals).toEqual(expect.arrayContaining([
            { kind: 'node', target: 'hub.xchain.io:443' },
            { kind: 'chromium', target: 'https://hub.xchain.io/' },
        ]));
        expect(after.lines).toContain('[xchain] network guard refused node hub.xchain.io:443');
        expect(after.lines).toContain('[xchain] network guard refused chromium https://hub.xchain.io/');
    } finally {
        await app.close();
    }
});
