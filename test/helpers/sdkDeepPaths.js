// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The ONE inventory of deep `xchain-sdk/src/...` paths this repo resolves.
//
// Two SDK layouts are in play: before the 0.19.0 code-structure pass and
// after. Most pre-pass spellings kept a re-export shim; src/endpoints.js (now
// src/utils/endpoints.js) and src/derivation.js (now src/protocol/derivation.js)
// did not. Each entry therefore lists the post-pass spelling first and the
// pre-pass one after it, so a call site is correct under either installed
// version regardless of whether the repin or the repoint lands first. Once the
// floor is past 0.19.0 the trailing spellings can be dropped.
//
// resolveSdkDeep() throws naming the module and every spelling it tried. A
// resolver that returns null instead reaches require() as
// `TypeError: The "id" argument must be of type string. Received null`, which
// names neither the path nor the repo that moved it.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

// Anchored at the SHELLS: only web, extension and desktop declare the
// `xchain-sdk` alias, so only they resolve it without relying on the
// workspace's shamefully-hoist flag. All three pin the identical spec, so the
// walk exists only to let a partially-installed shell fall through.
const SDK_ANCHOR_SHELLS = ['web', 'extension', 'desktop'];
const shellRequires = SDK_ANCHOR_SHELLS.map((shell) =>
    createRequire(join(repoRoot, 'packages', shell, 'package.json')));

/**
 * Deep SDK paths by logical name; value order is preference order.
 * @type {Record<string, string[]>}
 */
export const SDK_DEEP_PATHS = {
    coins: ['src/coins/index.js'],
    derivation: ['src/protocol/derivation.js', 'src/derivation.js'],
    endpoints: ['src/utils/endpoints.js', 'src/endpoints.js'],
    formats: ['src/formats.js'],
    formatSelector: ['src/formatSelector.js'],
    gatedFile: ['src/gatedFile.js'],
    musig2: ['src/musig2.js'],
    networks: ['src/networks.js'],
    preflightConstants: ['src/preflight/constants.js'],
    protocolConstants: ['src/protocol/constants.js'],
    wallet: ['src/wallet.js'],
};

/** Is the SDK installed at all? Asked of package.json, the one path a
 *  structure pass cannot move, so an absent SDK (a documented skip) stays
 *  distinct from a module the SDK moved (a drift that must red). */
export function sdkInstalled() {
    return resolveSpec('xchain-sdk/package.json') !== null;
}

/** Resolve one bare specifier through the shells, then through a sibling
 *  checkout. Returns the absolute filename, or null. */
function resolveSpec(spec) {
    for (const requireFromShell of shellRequires) {
        try {
            return requireFromShell.resolve(spec);
        } catch {
            // Next shell; the sibling fallback below is the last resort.
        }
    }
    const sibling = join(repoRoot, '..', ...spec.split('/'));
    return existsSync(sibling) ? sibling : null;
}

/**
 * Resolve a registered deep SDK path to an absolute filename.
 * @param {keyof typeof SDK_DEEP_PATHS | string} name
 * @returns {{ name: string, spec: string, filename: string }}
 * @throws when the name is not registered, or no candidate resolves.
 */
export function resolveSdkDeep(name) {
    const candidates = SDK_DEEP_PATHS[name];
    if (!candidates) {
        throw new Error(
            `unknown xchain-sdk deep path "${name}". Register it in `
            + 'test/helpers/sdkDeepPaths.js SDK_DEEP_PATHS before resolving it.'
        );
    }
    for (const candidate of candidates) {
        const spec = `xchain-sdk/${candidate}`;
        const filename = resolveSpec(spec);
        if (filename !== null) return { name, spec, filename };
    }
    throw new Error(
        `xchain-sdk deep path "${name}" does not resolve. Tried, in order: `
        + candidates.map((c) => `xchain-sdk/${c}`).join(', ')
        + `. ${sdkInstalled()
            ? 'The SDK IS installed, so it MOVED this module: add the new spelling to '
              + 'SDK_DEEP_PATHS in test/helpers/sdkDeepPaths.js.'
            : 'The SDK is not installed in this checkout; run pnpm install.'}`
    );
}

/** Load a registered deep SDK path. require, not a static import: a static
 *  deep import of a moved path fails at TRANSFORM time, killing every suite
 *  that imports the importer. */
export function requireSdkDeep(name) {
    return createRequire(import.meta.url)(resolveSdkDeep(name).filename);
}
