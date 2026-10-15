// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', 'packages');

function cssFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === 'www') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...cssFiles(path));
        else if (name.endsWith('.css')) out.push(path);
    }
    return out;
}

// --xc-control-border holds a colour. Used where a length belongs (a border
// width or a calc), it makes the declaration invalid and the browser drops it:
// every button lost its border that way, so outlined buttons read as text.
describe('control border colour token', () => {
    it('is never used as a length', () => {
        const misuse = /(border(-width)?\s*:\s*var\(--xc-control-border\s*,)|(calc\([^;]*var\(--xc-control-border\b)/;
        const offenders = cssFiles(root).filter((file) => misuse.test(readFileSync(file, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('keeps a 1px border on every button so outlined variants show their outline', () => {
        const css = readFileSync(join(root, 'core', 'src', 'ui', 'Button.module.css'), 'utf8');
        const btn = css.slice(css.indexOf('.btn {'), css.indexOf('}', css.indexOf('.btn {')));
        expect(btn).toMatch(/border:\s*1px solid transparent;/);
    });
});
