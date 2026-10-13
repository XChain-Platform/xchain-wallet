// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const WEB_INITIAL_JS_SIZE_LIMIT = 900_000;
export const WEB_INITIAL_CSS_SIZE_LIMIT = 100_000;

function sourceBytes(source) {
    return typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength;
}

/** Measure only assets fetched through the entry's static import graph. */
export function initialBundleSizes(bundle, entryName = 'index') {
    const entry = Object.values(bundle).find((output) => (
        output.type === 'chunk'
        && output.isEntry
        && output.name === entryName
    ));
    if (!entry) throw new Error(`web entry chunk ${JSON.stringify(entryName)} was not emitted`);

    const chunkFiles = new Set();
    const cssFiles = new Set();
    const visit = (chunk) => {
        if (chunkFiles.has(chunk.fileName)) return;
        chunkFiles.add(chunk.fileName);
        for (const fileName of chunk.viteMetadata?.importedCss ?? []) cssFiles.add(fileName);
        for (const fileName of chunk.imports) {
            const dependency = bundle[fileName];
            if (dependency?.type === 'chunk') visit(dependency);
        }
    };
    visit(entry);

    const jsBytes = [...chunkFiles].reduce(
        (total, fileName) => total + Buffer.byteLength(bundle[fileName].code),
        0,
    );
    const cssBytes = [...cssFiles].reduce((total, fileName) => {
        const asset = bundle[fileName];
        if (asset?.type !== 'asset') {
            throw new Error(`initial CSS asset ${JSON.stringify(fileName)} was not emitted`);
        }
        return total + sourceBytes(asset.source);
    }, 0);

    return { jsBytes, cssBytes };
}
