// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildConnect } from '../../../packages/connect/scripts/build.mjs';

const require = createRequire(import.meta.url);

describe('connect build script', () => {
    it('builds deterministic self-contained ESM, CJS and IIFE outputs', async () => {
        const tmpRoot = resolve('tmp');
        await mkdir(tmpRoot, { recursive: true });
        const fixtureDir = await mkdtemp(join(tmpRoot, 'connect-build-'));

        try {
            const helperPath = join(fixtureDir, 'helper.js');
            const entryPath = join(fixtureDir, 'entry.js');
            await writeFile(helperPath, [
                'export const answer = 42;',
                'export function greet(name) { return `hello, ${name}`; }',
                '',
            ].join('\n'));
            await writeFile(entryPath, "export { answer, greet } from './helper.js';\n");

            const first = await buildConnect({ entry: entryPath });
            const esmPath = join(fixtureDir, 'bundle.mjs');
            const cjsPath = join(fixtureDir, 'bundle.cjs');
            await writeFile(esmPath, first.esm);
            await writeFile(cjsPath, first.cjs);

            const esm = await import(pathToFileURL(esmPath).href);
            expect(esm.answer).toBe(42);
            expect(esm.greet('ESM')).toBe('hello, ESM');

            const cjs = require(cjsPath);
            expect(cjs.answer).toBe(42);
            expect(cjs.greet('CJS')).toBe('hello, CJS');

            const context = vm.createContext({});
            vm.runInContext(first.iife, context);
            expect(context.XChainConnect.answer).toBe(42);
            expect(context.XChainConnect.greet('IIFE')).toBe('hello, IIFE');

            for (const text of Object.values(first)) {
                expect(text).not.toMatch(/\bimport(?:\s|\{|\*|['"]|\()/);
                expect(text).not.toMatch(/\brequire\s*\(/);
            }

            await expect(buildConnect({ entry: entryPath })).resolves.toEqual(first);
        } finally {
            await rm(fixtureDir, { recursive: true, force: true });
        }
    });
});
