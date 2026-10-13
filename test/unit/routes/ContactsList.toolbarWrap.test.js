// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// At phone width each toolbar control takes a full row so the network filter
// keeps room for its full "All networks" label. jsdom has no layout, so the
// test pins the rules that make that happen.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ContactsList.module.css'),
    'utf8',
);
const source = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ContactsList.jsx'),
    'utf8',
);

const phoneRules = css.match(/@media \(max-width: 420px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';

describe('ContactsList toolbar at phone width', () => {
    it('applies the route toolbar layout to the controls', () => {
        expect(source).toMatch(/toolbar=\{\([\s\S]*?<div className=\{picker\.toolbar\}>/);
    });

    it('lets the toolbar wrap', () => {
        const rule = css.match(/\.toolbar\s*\{[^}]*\}/)[0];
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
    });

    it('gives each control its own row at 420px and below', () => {
        expect(phoneRules).toMatch(/\.search\s*\{[^}]*flex:\s*1 1 100%/);
        expect(phoneRules).toMatch(/\.sort\s*\{[^}]*flex:\s*1 1 100%/);
    });
});
