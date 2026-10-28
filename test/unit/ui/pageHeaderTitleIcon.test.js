// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later


// A page title is text only: no screen puts an icon in the title of its page header.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

describe('page titles carry no icon', () => {
    it('PageHeader renders the title as plain heading content', () => {
        const jsx = read('packages/core/src/ui/PageHeader.jsx');
        const heading = jsx.slice(jsx.indexOf('<h1'), jsx.indexOf('</h1>'));
        expect(heading).toContain('{title}');
        expect(heading).not.toMatch(/titleIcon|<svg|<img|Icon/);
        expect(jsx).not.toMatch(/titleIcon/);
        expect(read('packages/core/src/ui/PageHeader.module.css')).not.toMatch(/\.titleIcon/);
    });

    it('no source passes a title icon to a page header', () => {
        const out = spawnSync(
            'git',
            ['-C', root, 'grep', '-ln', 'titleIcon', '--', 'packages/*/src'],
            { encoding: 'utf8' },
        );
        expect(out.status).toBeLessThan(2);
        const hits = out.stdout.trim().split('\n').filter(Boolean);
        expect(hits).toEqual([]);
    });
});
