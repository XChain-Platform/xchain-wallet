// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);

describe('ManageToken holder data removal', () => {
    it('does not request or render holder data and keeps owner copy in Details', () => {
        expect(source).not.toContain('getHoldersForToken');
        expect(source).not.toContain('HoldersPanel');
        expect(source).toContain("ariaLabel={t('routes.manageToken.copyOwnerAddress')}");
    });
});
