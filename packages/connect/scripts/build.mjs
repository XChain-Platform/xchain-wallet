// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: MIT

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '../src');

const publicEntry = [
    "export * from './runtime.js';",
    "export * from './request.js';",
    "export * from './client.js';",
].join('\n');

export const CONNECT_OUTPUT_FILES = Object.freeze({
    esm: 'xchain-connect.js',
    cjs: 'xchain-connect.cjs',
    iife: 'xchain-connect.min.js',
});

const commonOptions = {
    bundle: true,
    external: [],
    target: 'es2020',
    write: false,
};

const outputText = (result) => result.outputFiles[0].text;

function entryOptions(entry) {
    if (entry !== undefined) return { entryPoints: [entry] };
    return {
        stdin: {
            contents: publicEntry,
            resolveDir: sourceDir,
            sourcefile: 'xchain-connect.js',
        },
    };
}

export async function buildConnect({ entry } = {}) {
    const input = entryOptions(entry);
    const [esm, cjs, iife] = await Promise.all([
        build({
            ...commonOptions,
            ...input,
            format: 'esm',
        }),
        build({
            ...commonOptions,
            ...input,
            format: 'cjs',
        }),
        build({
            ...commonOptions,
            ...input,
            format: 'iife',
            globalName: 'XChainConnect',
            minify: true,
        }),
    ]);

    return {
        esm: outputText(esm),
        cjs: outputText(cjs),
        iife: outputText(iife),
    };
}

export async function writeConnectBuild({
    entry,
    outdir = resolve(scriptDir, '../dist'),
} = {}) {
    const output = await buildConnect({ entry });
    await mkdir(outdir, { recursive: true });
    await Promise.all(Object.entries(CONNECT_OUTPUT_FILES).map(([format, file]) =>
        writeFile(resolve(outdir, file), output[format]),
    ));
    return Object.fromEntries(Object.entries(CONNECT_OUTPUT_FILES).map(([format, file]) =>
        [format, resolve(outdir, file)],
    ));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    await writeConnectBuild({ outdir: resolve(scriptDir, '../dist') });
}
