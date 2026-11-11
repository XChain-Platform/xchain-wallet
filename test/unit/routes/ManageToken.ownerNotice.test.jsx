// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);

describe('ManageToken owner notice removal', () => {
    it('contains neither the non-owner warning nor an Owned by hero line', () => {
        expect(source).not.toContain('thisWalletDoesnTHold');
        expect(source).not.toContain('ownedBy');
        expect(source).toContain('disabled: blockIssuerActions');
    });
});
