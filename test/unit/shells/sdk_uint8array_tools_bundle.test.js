// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

// xchain-sdk's bitcoinjs-lib 7 patch (src/utils/apply_bufferutils_patch/v7.js)
// assigns onto `require('uint8array-tools')`. In a browser build that
// package's exports map selects its ESM entry, whose CommonJS interop object
// is getter-only, so the assignment threw at SDK load and the web shell never
// got past "Verify your recovery phrase". The extension bundles the same SDK
// for its background and popup. The desktop renderer loads the SDK wallet
// module when it pairs a Ledger or a Trezor, so there the assignment fails
// every hardware pairing. This builds an entry that does what the SDK
// does through each shell's config and evaluates it.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, expect, it } from 'vitest';
import desktopConfig from '../../../packages/desktop/vite.config.js';
import extensionConfig from '../../../packages/extension/vite.config.js';
import webConfig from '../../../packages/web/vite.config.js';

const shells = [['web', webConfig], ['extension', extensionConfig], ['desktop', desktopConfig]];

// The web and desktop configs list aliases as find/replacement entries, the
// extension's as a plain map; both forms are what vite accepts.
function uint8ArrayToolsAlias(config) {
    const alias = config.resolve?.alias;
    if (!alias) return undefined;
    if (!Array.isArray(alias)) return alias['uint8array-tools'];
    const entry = alias.find((item) => item.find instanceof RegExp && item.find.test('uint8array-tools'));
    return entry && entry.replacement;
}

const fixtures = [];

afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true })));
    delete globalThis.__xcUint8ToolsPatched;
});

async function buildFixture(config) {
    const scratch = join(process.cwd(), 'tmp', 'node_modules');
    await mkdir(scratch, { recursive: true });
    // The path carries "node_modules" and "xchain-sdk" so the entry falls
    // inside every config's commonjsOptions.include (the desktop config keeps
    // Vite's default, node_modules only), as the real SDK file does; outside
    // it the require() is never transformed and the test proves nothing.
    const root = await mkdtemp(join(scratch, 'xchain-sdk-uint8array-tools-'));
    fixtures.push(root);
    const entry = join(root, 'entry.js');
    const outDir = join(root, 'dist');
    await writeFile(entry, [
        "const uint8Tools = require('uint8array-tools');",
        'uint8Tools.writeInt64 = uint8Tools.writeUInt64;',
        'uint8Tools.readInt64 = uint8Tools.readUInt64;',
        'globalThis.__xcUint8ToolsPatched = uint8Tools.writeInt64 === uint8Tools.writeUInt64;',
    ].join('\n'));
    await build({
        ...config,
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [],
        build: {
            ...config.build,
            outDir,
            sourcemap: false,
            lib: { entry, formats: ['es'], fileName: () => 'bundle.js' },
            rollupOptions: {},
        },
    });
    return join(outDir, 'bundle.js');
}

it.each(shells)('pins uint8array-tools to its CommonJS build for the %s bundle', (_name, config) => {
    const replacement = uint8ArrayToolsAlias(config);
    expect(replacement, 'vite.config.js has no uint8array-tools alias').toBeTruthy();
    expect(replacement.replace(/\\/g, '/')).toMatch(/\/uint8array-tools\/src\/cjs\/index\.cjs$/);
});

it.each(shells)('lets the SDK patch assign onto uint8array-tools in the %s bundle', async (_name, config) => {
    const bundlePath = await buildFixture(config);
    await expect(import(pathToFileURL(bundlePath).href)).resolves.toBeTruthy();
    expect(globalThis.__xcUint8ToolsPatched).toBe(true);
});
