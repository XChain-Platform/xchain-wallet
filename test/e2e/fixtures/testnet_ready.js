// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Proves the testnet venue, the treasury and the claimant ready in seconds.
// Every check global-setup.testnet.js makes runs here exactly as the run makes
// it, in that order, by calling its default export once: this file repeats and
// reorders nothing. There is no build, no preview server and no browser, and
// nothing is spent. The teardown setup returns is called at once, so the staged
// run input is removed and the environment variable unset before exit.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node test/e2e/fixtures/testnet_run_input.js <treasury.json> <claimant.json> '
    + '| node test/e2e/fixtures/testnet_ready.js';

async function loadSetup() {
    // Dynamic so a unit run that injects a setup never loads the SDK.
    const module = await import('../global-setup.testnet.js');
    return module.default;
}

export async function main({
    setup,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
} = {}) {
    if (stdin.isTTY) {
        stderr.write(`${USAGE}\n`);
        return 2;
    }
    try {
        const run = setup ?? await loadSetup();
        const teardown = await run();
        if (typeof teardown === 'function') {
            await teardown();
        }
    } catch (error) {
        stderr.write(`testnet run not ready: ${error?.message ?? error}\n`);
        return 1;
    }
    stdout.write('testnet run ready\n');
    return 0;
}

function invokedDirectly() {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
}

if (invokedDirectly()) {
    process.exitCode = await main();
}
