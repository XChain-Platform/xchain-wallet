// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);

describe('ManageToken activity removal', () => {
    it('does not request or render token activity on the management page', () => {
        expect(source).not.toContain('getHistoryForToken');
        expect(source).not.toContain('ActivityPanel');
        expect(source).not.toContain('onViewActivity');
    });
});
