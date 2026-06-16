// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Browser-facing shim for Node's `repl` module.
//
// xchain-sdk's index.js transitively loads src/repl.js at module init
// via `const { startREPL } = require('./src/repl.js')`, and repl.js
// starts with `const repl = require('repl')`. The REPL is a developer-
// only tool; the wallet never calls `startREPL`.
//
// This shim lets the browser bundler resolve `repl` without pulling in
// a polyfill. If anything actually calls `repl.start(...)` we throw
// with a loud message so the mistake is visible; the wallet should
// never hit that path.

function start(_options) {
    throw new Error(
        '[xchain-wallet] Node `repl` is not available in browser contexts. '
            + 'Avoid calling xchain-sdk.startREPL from wallet code.',
    );
}

export default { start };
export { start };
