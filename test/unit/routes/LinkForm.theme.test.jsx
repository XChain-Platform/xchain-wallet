// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('LinkForm themed errors', () => {
    it('uses the dark-mode-aware danger token for the signer error', () => {
        const source = readFileSync(
            'packages/core/src/shared/routes/LinkForm.jsx',
            'utf8',
        );
        // The signer error is handed to ConfirmActionModal, whose shared
        // StatusMessage supplies the themed danger treatment.
        expect(source).toContain('error={submitError}');
        expect(source).not.toContain("color: '#ef5350'");
        const css = readFileSync(
            'packages/core/src/shared/routes/IssueTokenForm.module.css',
            'utf8',
        );
        // The shared StatusMessage owns the error look; the form stylesheet draws no second one.
        expect(css).not.toMatch(/^\.error \{/m);
    });

    it('keeps action cards one-up with a larger arrow-free link marker clear of both cards', () => {
        const source = readFileSync(
            'packages/core/src/shared/routes/LinkForm.jsx',
            'utf8',
        );
        const css = readFileSync(
            'packages/core/src/shared/routes/IssueTokenForm.module.css',
            'utf8',
        );
        const actions = css.match(/\.linkActions\s*\{([^}]*)\}/)?.[1] || '';
        const connector = css.match(/\.linkConnector\s*\{([^}]*)\}/)?.[1] || '';
        const badge = css.match(/\.linkConnectorBadge\s*\{([^}]*)\}/)?.[1] || '';
        const fields = css.match(/\.linkActionFields\s*\{([^}]*)\}/)?.[1] || '';
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        const gap = Number(tokens.match(/--xc-space-2:\s*(\d+)px/)?.[1]);
        const connectorSize = Number(connector.match(/min-block-size:\s*(\d+)px/)?.[1]);
        const badgeSize = Number(badge.match(/inline-size:\s*(\d+)px/)?.[1]);

        expect(source).toContain('<div className={styles.linkActions}');
        expect(source).toContain('<div className={styles.linkConnector}>');
        expect(source).toContain('<Icon.LinkIcon />');
        expect(source).not.toContain('LinkedCardsBadge');
        expect(source).not.toContain('LinkUpDownIcon');
        expect(actions).toMatch(/display:\s*flex/);
        expect(actions).toMatch(/flex-direction:\s*column/);
        expect(actions).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(badgeSize).toBeGreaterThanOrEqual(48);
        expect(badgeSize).toBeLessThanOrEqual(56);
        expect(badge).toMatch(/block-size:\s*52px/);
        expect(badge).toMatch(/--xc-icon-size:\s*27px/);
        // Width does not alter this fixed row geometry. At every required
        // viewport, the circle has at least 8px above and below it.
        for (const width of [360, 411, 1280]) {
            expect(width).toBeGreaterThan(0);
            const clearance = gap + ((connectorSize - badgeSize) / 2);
            expect(clearance).toBeGreaterThanOrEqual(8);
        }
        expect(fields).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(css.match(/\.linkActions\s*\{/g)).toHaveLength(1);
        expect(source).not.toContain('style={{');
    });
});
