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

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, expect, it } from 'vitest';
import webConfig from '../../../packages/web/vite.config.js';

const fixtures = [];

afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true })));
    delete globalThis.__sdkRequireMainLoaded;
});

async function buildFixture() {
    const scratch = join(process.cwd(), 'tmp');
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, 'sdk-require-main-'));
    fixtures.push(root);
    const entry = join(root, 'entry.js');
    const outDir = join(root, 'dist');
    await writeFile(entry, [
        'if (require.main === module) { throw new Error("CLI entry ran"); }',
        'globalThis.__sdkRequireMainLoaded = true;',
    ].join('\n'));
    await build({
        ...webConfig,
        configFile: false,
        root,
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

it('evaluates an SDK-style require.main guard in a browser bundle', async () => {
    const bundlePath = await buildFixture();
    const source = await readFile(bundlePath, 'utf8');
    expect(source).not.toContain('require.main');
    await expect(import(pathToFileURL(bundlePath).href)).resolves.toBeTruthy();
    expect(globalThis.__sdkRequireMainLoaded).toBe(true);
});
