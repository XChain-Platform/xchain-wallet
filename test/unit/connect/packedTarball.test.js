// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, '../../..');
const connectDir = join(repoRoot, 'packages/connect');

async function listFiles(root, directory = root) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return listFiles(root, path);
        return relative(root, path);
    }));
    return files.flat().sort();
}

describe('connect packed tarball', () => {
    it('contains only the published package surface and loads both module builds', async () => {
        const tmpRoot = join(repoRoot, 'tmp');
        await mkdir(tmpRoot, { recursive: true });
        const fixtureDir = await mkdtemp(join(tmpRoot, 'connect-pack-'));
        const packDir = join(fixtureDir, 'packed');
        const extractDir = join(fixtureDir, 'extracted');
        await mkdir(packDir);
        await mkdir(extractDir);

        try {
            await execFileAsync('pnpm', ['pack', '--pack-destination', packDir], {
                cwd: connectDir,
                timeout: 120_000,
            });
            const tarballs = (await readdir(packDir)).filter((file) => file.endsWith('.tgz'));
            expect(tarballs).toHaveLength(1);
            await execFileAsync('tar', [
                '-xzf',
                join(packDir, tarballs[0]),
                '-C',
                extractDir,
            ], { timeout: 120_000 });

            const packageDir = join(extractDir, 'package');
            const packedFiles = await listFiles(packageDir);
            const declarations = packedFiles.filter((file) => /^dist\/.*\.d\.ts$/.test(file));
            expect(declarations.length).toBeGreaterThan(0);
            expect(declarations).toContain('dist/index.d.ts');
            expect(packedFiles.filter((file) => !declarations.includes(file))).toEqual([
                'LICENSE',
                'README.md',
                'dist/xchain-connect.cjs',
                'dist/xchain-connect.js',
                'dist/xchain-connect.min.js',
                'package.json',
                'wallet-requests.json',
            ]);

            const packedManifest = JSON.parse(await readFile(
                join(packageDir, 'package.json'),
                'utf8',
            ));
            expect({
                main: packedManifest.main,
                module: packedManifest.module,
                types: packedManifest.types,
                exports: packedManifest.exports,
            }).toEqual({
                main: './dist/xchain-connect.cjs',
                module: './dist/xchain-connect.js',
                types: './dist/index.d.ts',
                exports: {
                    '.': {
                        types: './dist/index.d.ts',
                        import: './dist/xchain-connect.js',
                        require: './dist/xchain-connect.cjs',
                    },
                    './wallet-requests.json': './wallet-requests.json',
                    './xchain-connect.min.js': './dist/xchain-connect.min.js',
                    './package.json': './package.json',
                },
            });
            expect(packedManifest.publishConfig.access).toBe('public');

            const cjs = require(join(packageDir, packedManifest.main));
            const esm = await import(pathToFileURL(join(packageDir, packedManifest.module)).href);
            expect(cjs.PROTOCOL_VERSION).toEqual(expect.any(String));
            expect(esm.PROTOCOL_VERSION).toEqual(expect.any(String));

            const [packedRequests, workspaceRequests] = await Promise.all([
                readFile(join(packageDir, 'wallet-requests.json')),
                readFile(join(connectDir, 'wallet-requests.json')),
            ]);
            expect(packedRequests).toEqual(workspaceRequests);

            const workspaceManifest = JSON.parse(await readFile(
                join(connectDir, 'package.json'),
                'utf8',
            ));
            expect(workspaceManifest.main).toBe('./src/runtime.js');
            expect(workspaceManifest.types).toBe('./src/index.ts');
            expect(workspaceManifest).not.toHaveProperty('exports');
        } finally {
            await rm(fixtureDir, { recursive: true, force: true });
        }
    }, 120_000);
});
