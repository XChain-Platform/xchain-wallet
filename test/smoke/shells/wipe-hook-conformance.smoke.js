// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-shell "wipe wallet data" conformance.
//
// Core's `wipeWalletStorage()` clears the two renderer stores itself and
// then hands off to `globalThis.xchainWalletBridge.wipeStorage()` if a
// shell published one. That feature-detect is FAIL-OPEN: a shell that
// keeps its state where the renderer cannot reach it and publishes no hook
// gets a silent, successful-looking no-op. That is precisely how the
// extension shipped a "Forgot password" wipe that erased nothing while the
// vault, the session master key and the CACHED PLAINTEXT PASSWORD all
// stayed in chrome.storage for the rest of the browser session.
//
// This census is the fail-closed half, moved to build time where it costs
// nothing at runtime: every shell that owns out-of-renderer state must
// publish the hook, and every extension page entry must install it. A new
// page entry that forgets is a red test here, not a silent regression.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, '..', '..', '..', 'packages');

// --- 1. core still routes the wipe through the shell hook -------------

const coreWipe = readFileSync(
    join(packages, 'core', 'src', 'shared', 'utils', 'wipeWalletStorage.js'),
    'utf8',
);
assert.ok(
    /bridge\.wipeStorage\(\)/.test(coreWipe),
    'core wipeWalletStorage() still hands off to the shell hook',
);
// Flattened first: the sentence this catches wraps across comment lines,
// so a raw-source regex silently matches nothing and passes forever.
const coreWipeFlat = coreWipe.replace(/\n\s*\*\s?/g, ' ');
assert.ok(
    /their stores having already been cleared above/.test(
        'Web and extension expose no such hook and no-op here, their stores having already been cleared above',
    ),
    'self-check: the flattening probe is looking for a sentence that really existed',
);
assert.ok(
    !/Web and extension expose no such hook/.test(coreWipeFlat),
    'the docstring no longer claims the extension has nothing shell-side to clear',
);

// --- 2. every shell with out-of-renderer state publishes a hook -------

const publishers = [
    ['desktop preload', join(packages, 'desktop', 'preload.cjs'), /wipeStorage\(\)\s*\{/],
    ['native mobile shell', join(packages, 'web', 'src', 'storage', 'backends.js'), /wipeStorage:\s*async/],
    ['extension pages', join(packages, 'extension', 'src', 'storage', 'wipeHook.js'), /wipeStorage:\s*async/],
];
for (const [label, file, needle] of publishers) {
    const src = readFileSync(file, 'utf8');
    assert.ok(needle.test(src), `${label} publishes xchainWalletBridge.wipeStorage`);
    assert.ok(
        /xchainWalletBridge/.test(src),
        `${label} publishes it on the bridge core feature-detects`,
    );
}

// The extension's hook is argument-free, the same un-aimable contract
// test/integration/shells/desktop-preload-contract.test.js pins for
// desktop: the page says "wipe", the worker decides what that means.
const extHook = readFileSync(
    join(packages, 'extension', 'src', 'storage', 'wipeHook.js'),
    'utf8',
);
assert.ok(
    /wipeStorage:\s*async\s*\(\)\s*=>/.test(extHook),
    'the extension wipe hook takes no arguments',
);

// --- 3. every extension page entry installs it ------------------------
//
// Driven off the shipped HTML entries rather than a hand-list, so a new
// page cannot be added without either installing the hook or reddening
// this smoke.

const extension = join(packages, 'extension');
const htmlEntries = readdirSync(extension).filter((f) => f.endsWith('.html'));
assert.ok(htmlEntries.length >= 3, 'found the extension HTML page entries to check');

const missing = [];
const checked = [];
for (const html of htmlEntries) {
    const src = readFileSync(join(extension, html), 'utf8');
    const m = src.match(/<script[^>]*type="module"[^>]*src="\.\/([^"]+)"/);
    assert.ok(m, `${html} declares a module entry script`);
    const entry = join(extension, m[1]);
    const entrySrc = readFileSync(entry, 'utf8');
    checked.push(`${html} -> ${m[1]}`);
    if (!/installExtensionWipeHook\(\)/.test(entrySrc)) missing.push(`${html} -> ${m[1]}`);
}
assert.equal(
    missing.join(', '),
    '',
    `every extension page entry must call installExtensionWipeHook(); missing in: ${missing.join(', ')}`,
);
assert.ok(checked.length > 0, 'the page-entry census ran over at least one entry');

// --- 4. the worker owns the clear, and tears the host down ------------

const wipeModule = readFileSync(
    join(extension, 'src', 'background', 'wipeExtensionStorage.js'),
    'utf8',
);
for (const key of [
    'xchain-wallet:vault',
    'xchain-wallet:vault-meta',
    'xchain:unlockThrottle',
]) {
    assert.ok(wipeModule.includes(`'${key}'`), `the wipe clears ${key}`);
}
assert.ok(
    /session\.clear\(\)/.test(wipeModule),
    'the wipe clears chrome.storage.session wholesale (master key + cached password)',
);
assert.ok(
    /isTrustedExtensionSender/.test(wipeModule),
    'the wipe message is gated: a web origin cannot erase a wallet',
);

const background = readFileSync(join(extension, 'src', 'background.js'), 'utf8');
assert.ok(
    /attachWipeStorageListener\(\{\s*onWiped:\s*\(\)\s*=>\s*tearDownHost\(\)\s*\}\)/.test(background),
    'background.js runs the wipe in the service worker and tears the host down after it',
);

console.log(
    `OK: wipe-hook conformance smoke (core still routes through xchainWalletBridge.wipeStorage; desktop preload, native mobile shell and the extension all publish one; ${checked.length} extension page entries install it (${checked.join(', ')}); the worker-side clear covers the vault, meta, throttle and the whole session store, is sender-gated, and tears the host down)`,
);
