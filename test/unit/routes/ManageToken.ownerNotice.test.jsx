// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
    'utf8',
);

describe('issuer actions: owner notice removal', () => {
    it('contains neither the non-owner warning, ownership pre-lock, nor an Owned by hero line', () => {
        expect(source).not.toContain('thisWalletDoesnTHold');
        expect(source).not.toContain('ownedBy');
        expect(source).not.toContain('blockIssuerActions');
        expect(source).not.toContain('ownerActionUnavailable');
    });
});
