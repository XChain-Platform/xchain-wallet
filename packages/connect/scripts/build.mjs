// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: MIT

import { build } from 'esbuild';

const commonOptions = {
    bundle: true,
    external: [],
    target: 'es2020',
    write: false,
};

const outputText = (result) => result.outputFiles[0].text;

export async function buildConnect({ entry }) {
    const [esm, cjs, iife] = await Promise.all([
        build({
            ...commonOptions,
            entryPoints: [entry],
            format: 'esm',
        }),
        build({
            ...commonOptions,
            entryPoints: [entry],
            format: 'cjs',
        }),
        build({
            ...commonOptions,
            entryPoints: [entry],
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
