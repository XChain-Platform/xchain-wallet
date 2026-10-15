// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Installs the test network guard (networkGuard.js) as a side effect of
// being imported. index.js imports this module first, so the socket wrap
// and the startup line land before any other main-process module has
// evaluated, let alone opened a connection or a window. Off unless
// XCHAIN_TEST_NETWORK_GUARD or --xchain-test-network-guard is set.

import { app, net } from 'electron';
import https from 'node:https';
import { Socket } from 'node:net';

import { installNetworkGuard, runNetworkGuardProbe } from './networkGuard.js';

export const networkGuard = installNetworkGuard({
    app,
    Socket,
    env: process.env,
    argv: process.argv,
});

// Only when on: the e2e harness reads the guard's lines and refusals from
// the main process with app.evaluate. Main-process global, out of reach
// of the sandboxed, context-isolated renderer.
if (networkGuard.on) globalThis.__xchainNetworkGuard = networkGuard;

/**
 * Probe mode: prove every egress path is refused, then exit with 0 (all
 * refused) or 1, before any window is created. Call after app ready.
 */
export async function runNetworkGuardProbeAndExit() {
    const pass = await runNetworkGuardProbe(networkGuard, {
        netFetch: (url) => net.fetch(url),
        https,
    });
    app.exit(pass ? 0 : 1);
}
