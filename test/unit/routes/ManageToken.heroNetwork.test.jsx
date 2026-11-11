// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);

describe('ManageToken identity box', () => {
    it('uses the 40px chain-aware token mark and contains no textual network label', () => {
        expect(source).toContain('<TickerIcon chainId={chainId} tick={tick} context="list" />');
        expect(source).not.toContain('descriptor.displayName');
        expect(source).not.toContain('chainRegistry');
    });
});
