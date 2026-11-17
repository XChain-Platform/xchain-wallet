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

describe('ManageToken selects the shared token hero', () => {
    it('keeps the shared asset page in owner view', () => {
        expect(source).toContain('<TokenDetail');
        expect(source).toContain('ownerView');
        expect(source).not.toContain('<Screen');
        expect(detailSource).toContain('Every coin and token surface uses the same Home-style');
        expect(detailSource).toContain('showHeroChart ? `${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart}`');
        expect(detailSource).not.toContain('aria-label="Token identity"');
        expect(detailStyles).toMatch(/\.cardCaptionIconWrap\s*\{/);
    });
});
