// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);
const detailSource = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.jsx'),
    'utf8',
);
const detailStyles = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'),
    'utf8',
);

describe('ManageToken selects the owner identity header', () => {
    it('keeps the shared asset page in owner view', () => {
        expect(source).toContain('<TokenDetail');
        expect(source).toContain('ownerView');
        expect(source).not.toContain('<Screen');
        expect(detailSource).toContain('aria-label="Token identity"');
        expect(detailSource).toContain('<TickerIcon chainId={chainId} tick={tick} context="list" />');
        expect(detailStyles).toMatch(/\.manageIdentityIcon\s*\{[^}]*--xc-avatar-size-list:\s*48px/s);
    });
});
