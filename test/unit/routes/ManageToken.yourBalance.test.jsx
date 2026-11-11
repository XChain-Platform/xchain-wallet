// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);

describe('ManageToken balance stats removal', () => {
    it('does not request wallet balances or render a holding statistic', () => {
        expect(source).not.toContain('getWalletBalances');
        expect(source).not.toContain('yourBalance');
        expect(source).not.toContain('youHold');
    });
});
