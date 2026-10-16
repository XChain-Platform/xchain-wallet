// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later


// A page title that wraps keeps its icon beside the first line.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name) => readFileSync(resolve(process.cwd(), `packages/core/src/ui/${name}`), 'utf8');

describe('PageHeader title icon', () => {
    it('renders the icon inside the heading, so a wrapped title keeps it beside the first line', () => {
        const jsx = read('PageHeader.jsx');
        const heading = jsx.slice(jsx.indexOf('<h1'), jsx.indexOf('</h1>'));
        expect(heading).toContain('styles.titleIcon');
        expect(read('PageHeader.module.css')).toMatch(/\.titleIcon \{[^}]*vertical-align:\s*middle/);
    });
});
