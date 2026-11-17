// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('packages/core/src/shared/routes/DispenserDetail.module.css');
const jsx = read('packages/core/src/shared/routes/DispenserDetail.jsx');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
}

describe('Dispenser detail wide panel layout', () => {
    it('stacks the embedded hero and tabs in one full-width fluid column', () => {
        expect(jsx).toContain('if (embedded) return page;');

        const layout = rule('.layout');
        const column = rule('.layout > .column');
        expect(css).toMatch(/\.layout,\s*\.column\s*\{[^}]*flex-direction:\s*column/s);
        expect(layout).toMatch(/width:\s*100%/);
        expect(layout).toMatch(/max-width:\s*none/);
        expect(layout).not.toMatch(/flex-flow:\s*row|grid-template-columns|column-count/);
        expect(column).toMatch(/width:\s*100%/);
        expect(column).toMatch(/max-width:\s*none/);
        expect(column).not.toMatch(/flex:\s*1\s+1|grid-column/);
    });
});
