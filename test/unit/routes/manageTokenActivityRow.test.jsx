// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
    'utf8',
);

// The token's history is the asset page's History tab; the issuer's module
// requests and renders none of its own.
describe('issuer actions: no activity of their own', () => {
    it('does not request or render token activity', () => {
        expect(source).not.toContain('getHistoryForToken');
        expect(source).not.toContain('ActivityPanel');
        expect(source).not.toContain('onViewActivity');
    });
});
