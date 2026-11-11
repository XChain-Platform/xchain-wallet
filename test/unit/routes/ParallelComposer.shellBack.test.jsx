// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apps = [
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
    'packages/extension/src/popup/App.jsx',
];

function parallelComposeBlock(path) {
    const source = readFileSync(path, 'utf8');
    const start = source.indexOf("if (unlockedView === 'parallel-compose'");
    const end = source.indexOf("if (unlockedView === '", start + 1);
    return source.slice(start, end);
}

describe('ParallelComposer shell back target', () => {
    it.each(apps)('%s returns to its launcher and clears template prefill', (path) => {
        const block = parallelComposeBlock(path);

        expect(block).toContain('setParallelPrefill(null)');
        expect(block).toContain("setUnlockedView('cross-chain-templates')");
        expect(block).toContain('formBack()');
        expect(block).toContain("setUnlockedView('settings')");
        expect(block).not.toContain("setUnlockedView('actions')");
    });
});
