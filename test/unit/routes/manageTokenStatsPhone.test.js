// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.module.css'),
    'utf8',
);

describe('ManageToken phone action grid', () => {
    it('keeps the action tiles three across at every width', () => {
        expect(css).toMatch(/\.approvedActionGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
        expect(css.match(/\.approvedActionGrid\s*\{/g)).toHaveLength(1);
        expect(css).not.toContain('.statsStrip');
    });
});
