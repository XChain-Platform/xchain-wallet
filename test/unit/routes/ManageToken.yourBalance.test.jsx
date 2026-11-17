// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
    'utf8',
);

// The management identity card has no balance, and the issuer's module reads
// no wallet balances or holding statistic of its own.
describe('issuer actions: no balance stats', () => {
    it('does not request wallet balances or render a holding statistic', () => {
        expect(source).not.toContain('getWalletBalances');
        expect(source).not.toContain('yourBalance');
        expect(source).not.toContain('youHold');
    });
});
