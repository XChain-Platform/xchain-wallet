// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// History draws the rows under each day heading as one flush card with
// dividers, the list Home shows in its Activity tab, instead of a card per
// row. timelineRuns splits the timeline into those headings and runs.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { timelineRuns } from '../../../packages/core/src/shared/routes/History.jsx';

describe('History timeline runs', () => {
    it('groups the rows between day headings into one run each', () => {
        const runs = timelineRuns([
            { kind: 'day', key: 'pending', label: 'Pending activity' },
            { kind: 'entry', entry: { key: 'a' } },
            { kind: 'entry', entry: { key: 'b' } },
            { kind: 'day', key: 'today', label: 'Today' },
            { kind: 'group', key: 'g1', members: [] },
            { kind: 'entry', entry: { key: 'c' } },
        ]);
        expect(runs.map((run) => [run.kind, run.key, run.items?.length ?? 0])).toEqual([
            ['day', 'pending', 0],
            ['rows', 'rows:a', 2],
            ['day', 'today', 0],
            ['rows', 'rows:g1', 2],
        ]);
    });

    it('draws History and Home activity rows as divided rows inside one flush card', () => {
        const row = readFileSync('packages/core/src/shared/components/ActivityRow.module.css', 'utf8');
        const history = readFileSync('packages/core/src/shared/routes/History.module.css', 'utf8');
        const home = readFileSync('packages/core/src/shared/components/HomeTabs.module.css', 'utf8');
        const rowRule = /\n\.row \{([^}]*)\}/.exec(row)[1];
        expect(rowRule).not.toMatch(/composes:/);
        expect(rowRule).toMatch(/border:\s*0/);
        expect(rowRule).toMatch(/padding:\s*var\(--xc-card-pad\)/);
        expect(history).toMatch(/\.rowList \{\s*composes: flush from '\.\.\/\.\.\/ui\/Card\.module\.css';/);
        expect(history).toMatch(/\.rowList > li \+ li \{\s*border-top: 1px solid var\(--xc-border\);/);
        expect(home).toMatch(/\.activityList > li \+ li \{\s*border-top: 1px solid var\(--xc-border\);/);
    });
});
