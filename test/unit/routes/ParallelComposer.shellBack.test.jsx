// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Back from the Action queue walks the shell's navigation history, so it
// returns to whichever page opened the queue (Settings, Token Actions, the
// palette's page) instead of a fixed launcher.

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
    it.each(apps)('%s returns to the page that opened the queue', (path) => {
        const block = parallelComposeBlock(path);
        expect(block).toContain('<ParallelComposer');
        // formBack drops any form prefill and pops the history.
        expect(block).toContain('onBack={formBack}');
        expect(block).not.toMatch(/setUnlockedView\('(settings|actions|home)'\)/);
    });

    it.each(apps)('%s opens the queue from Settings as a push, so Back returns to Settings', (path) => {
        const source = readFileSync(path, 'utf8');
        expect(source).toContain("onNavigateToActionQueue={() => setUnlockedView('parallel-compose')}");
        expect(source).toMatch(/const formBack = \(\) => \{[\s\S]*?goBack\(\);\s*\};/);
    });
});
