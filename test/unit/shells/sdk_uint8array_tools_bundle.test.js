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
// got past "Verify your recovery phrase". This builds an entry that
// does what the SDK does through the web config and evaluates it.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, expect, it } from 'vitest';
import webConfig from '../../../packages/web/vite.config.js';

const fixtures = [];

afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true })));
    delete globalThis.__xcUint8ToolsPatched;
});

async function buildFixture() {
    const scratch = join(process.cwd(), 'tmp');
    await mkdir(scratch, { recursive: true });
    // The directory name carries "xchain-sdk" so the entry falls inside the
    // config's commonjsOptions.include, as the real SDK file does; outside it
    // the require() is never transformed and the test proves nothing.
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
        ...webConfig,
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [],
        build: {
            ...webConfig.build,
            outDir,
            sourcemap: false,
            lib: { entry, formats: ['es'], fileName: () => 'bundle.js' },
            rollupOptions: {},
        },
    });
    return join(outDir, 'bundle.js');
}

it('pins uint8array-tools to its CommonJS build for the browser bundle', () => {
    const alias = webConfig.resolve.alias.find(
        (entry) => entry.find instanceof RegExp && entry.find.test('uint8array-tools'),
    );
    expect(alias, 'vite.config.js has no uint8array-tools alias').toBeTruthy();
    expect(alias.replacement.replace(/\\/g, '/')).toMatch(/\/uint8array-tools\/src\/cjs\/index\.cjs$/);
});

it('lets the SDK patch assign onto uint8array-tools in a browser bundle', async () => {
    const bundlePath = await buildFixture();
    await expect(import(pathToFileURL(bundlePath).href)).resolves.toBeTruthy();
    expect(globalThis.__xcUint8ToolsPatched).toBe(true);
});
