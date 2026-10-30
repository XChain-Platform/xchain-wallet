// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every desktop test launch goes through here, so every one runs under the
// app's test network guard (packages/desktop/main/networkGuard.js): only
// this machine, plus any host in XCHAIN_TEST_NETWORK_GUARD_ALLOW, can be
// reached. Two runs reached hub.xchain.io and explorer.xchain.io because
// their block rode in NODE_OPTIONS, which electron.launch drops; the guard
// is turned on by both a launch argument and an environment variable, and
// launchGuardedElectron refuses to hand back an app whose guard is not on.

import {
    ALLOW_ENV,
    ALLOW_SWITCH,
    GUARD_ENV,
    GUARD_ON_TEXT,
    GUARD_SWITCH,
} from '../../../packages/desktop/main/networkGuard.js';

export { FIRST_WINDOW_TEXT, GUARD_ON_TEXT, PROBE_SWITCH } from '../../../packages/desktop/main/networkGuard.js';

/**
 * electron.launch options with the guard switched on both ways.
 *
 * @param {{ args?: string[], env?: Record<string, string> } & Record<string, unknown>} options
 */
export function guardedLaunchOptions(options = {}) {
    const allow = process.env[ALLOW_ENV];
    return {
        ...options,
        args: [
            ...(options.args ?? []),
            `--${GUARD_SWITCH}`,
            // Chromium's mock keychain: a test launch never reads or prompts
            // for the Keychain item of an installed wallet.
            '--use-mock-keychain',
            ...(allow ? [`--${ALLOW_SWITCH}=${allow}`] : []),
        ],
        // electron.launch replaces the environment when `env` is given, so
        // start from this process's own.
        env: { ...process.env, ...(options.env ?? {}), [GUARD_ENV]: '1',
            // Test launches never take focus or show in the Dock.
            XCHAIN_TEST_NO_FOCUS: '1',
            XCHAIN_TEST_MOCK_KEYCHAIN: '1',
        },
    };
}

/**
 * The guard as the app's main process sees it: null when it is off.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @returns {Promise<{ on: boolean, lines: string[], refusals: Array<{ kind: string, target: string }> } | null>}
 */
export function readNetworkGuard(app) {
    return app.evaluate(() => {
        const guard = globalThis.__xchainNetworkGuard;
        if (!guard) return null;
        return { on: guard.on, lines: [...guard.lines], refusals: guard.refusals.map((r) => ({ ...r })) };
    });
}

/**
 * Launch the desktop app with the network guard on, and close it again
 * at once if the guard did not come up.
 *
 * @param {typeof import('@playwright/test')._electron} electron
 * @param {Parameters<typeof guardedLaunchOptions>[0]} options
 */
export async function launchGuardedElectron(electron, options) {
    const app = await electron.launch(guardedLaunchOptions(options));
    let guard = null;
    let failure = null;
    try {
        guard = await readNetworkGuard(app);
    } catch (err) {
        failure = err;
    }
    if (!guard?.on || !String(guard.lines[0] ?? '').startsWith(GUARD_ON_TEXT)) {
        await app.close().catch(() => {});
        throw new Error('the desktop app started without its test network guard, so this run stops here '
            + `(${failure ? String(failure) : `guard lines: ${JSON.stringify(guard?.lines ?? null)}`})`);
    }
    return app;
}

/**
 * Close a test launch of the app, and stop its process if the app does not
 * exit in time. An unlocked wallet defers quit while any wallet message is
 * in flight, and under the guard its background reads wait out their
 * timeouts, so a plain close can wait for minutes.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {number} [timeoutMs]
 */
export async function closeElectron(app, timeoutMs = 20_000) {
    const proc = app.process();
    let timer = null;
    const closed = await Promise.race([
        app.close().then(() => true, () => true),
        new Promise((done) => { timer = setTimeout(() => done(false), timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (!closed && proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
}
