// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);

describe('ManageToken price history removal', () => {
    it('contains no price chart, demo synthesis, or chart ranges', () => {
        expect(source).not.toContain('Sparkline');
        expect(source).not.toContain('synthesizeTokenChart');
        expect(source).not.toContain('CHART_RANGES');
        expect(source).not.toContain('isDemoWallet');
    });
});
