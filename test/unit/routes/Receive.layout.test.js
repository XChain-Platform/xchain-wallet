// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.module.css'),
    'utf8',
);

describe('Receive action layout', () => {
    it('stacks full-width actions on narrow phones without fixed pixel widths', () => {
        const narrowBreakpoint = css.match(
            /@media not all and \(min-width: (\d+)px\) \{[\s\S]*?\.qrActions/,
        );
        expect(Number(narrowBreakpoint?.[1])).toBeGreaterThan(412);
        expect(css).toMatch(
            /@media not all and \(min-width: 480px\) \{[\s\S]*?\.qrActions\s*\{\s*flex-direction: column;[\s\S]*?\.qrActions > \*\s*\{[\s\S]*?width: 100%;/,
        );

        const actionRules = [...css.matchAll(/\.qrActions > \*\s*\{([^}]*)\}/g)];
        expect(actionRules).toHaveLength(2);
        for (const [, declarations] of actionRules) {
            expect(declarations).not.toMatch(/(?:^|;)\s*(?:min-|max-)?width:\s*\d+(?:\.\d+)?px/);
        }
    });
});
