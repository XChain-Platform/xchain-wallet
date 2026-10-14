// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Rows inside the authoring forms are spaced by the form gap alone. Three of
// them still carried a margin from before the form owned its spacing, so the
// space under them read 8 to 12px wider than every other gap: Publish
// contract's Validate / Estimate / Suggest row, Airdrop's upload button and
// the parallel composer's row-state line.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

describe('authoring form rows add no margin to the form gap', () => {
    it.each([
        ['packages/core/src/shared/routes/ContractScreens.module.css', '.toolActions'],
        ['packages/core/src/shared/routes/ParallelComposer.module.css', '.rowStatus'],
    ])('%s %s has no block margin', (file, selector) => {
        const body = ruleBody(read(file), selector);
        expect(body).not.toBeNull();
        expect(body).not.toMatch(/margin(-top|-bottom|-block[a-z-]*)?\s*:/);
    });

    it('wraps the airdrop upload button without a bottom margin', () => {
        const source = read('packages/core/src/shared/routes/AirdropForm.jsx');
        const upload = source.indexOf('ref={fileInputRef}');
        const wrapper = source.lastIndexOf('<div', upload);
        expect(source.slice(wrapper, upload)).not.toMatch(/margin/i);
    });
});

// Poll options, bet outcomes and the per-outcome notes are stacks of ordinary
// fields, but their group spaced them 8px apart while the form around them
// uses its 16px gap. Each group now uses the form gap token.
describe('repeated-field groups use the form gap', () => {
    it.each([
        ['packages/core/src/shared/routes/CreatePollForm.jsx', 1],
        ['packages/core/src/shared/routes/CreateBetFeedForm.jsx', 2],
    ])('%s stacks its field groups on --xc-form-gap', (file, groups) => {
        const source = read(file);
        const columns = [...source.matchAll(/style=\{\{ display: 'flex', flexDirection: 'column', gap: '([^']+)' \}\}/g)]
            .map((m) => m[1]);
        expect(columns).toHaveLength(groups);
        for (const gap of columns) expect(gap).toBe('var(--xc-form-gap)');
    });
});
