// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
    'utf8',
);

// Holders stay one Details row of the asset page (read when chosen); the
// issuer's module adds no holder read of its own.
describe('issuer actions: no holder data', () => {
    it('does not request or render holder data', () => {
        expect(source).not.toContain('getHoldersForToken');
        expect(source).not.toContain('HoldersPanel');
    });
});
