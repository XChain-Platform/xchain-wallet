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
        // The signer error renders through FormPage status as a StatusMessage
        // styled by the shared component, not an inline colour.
        expect(source).toContain('<StatusMessage variant="error">{submitError}</StatusMessage>');
        expect(source).not.toContain("color: '#ef5350'");
        const css = readFileSync(
            'packages/core/src/shared/routes/IssueTokenForm.module.css',
            'utf8',
        );
        // The shared StatusMessage owns the error look; the form stylesheet draws no second one.
        expect(css).not.toMatch(/^\.error \{/m);
    });

    it('keeps network panels one-up until the 834px boundary', () => {
        const source = readFileSync(
            'packages/core/src/shared/routes/LinkForm.jsx',
            'utf8',
        );
        const css = readFileSync(
            'packages/core/src/shared/routes/IssueTokenForm.module.css',
            'utf8',
        );
        const base = css.match(/\.linkPanels\s*\{([^}]*)\}/)?.[1] || '';
        const tablet = css.match(/@media \(min-width: 834px\)\s*\{[\s\S]*?\.linkPanels\s*\{([^}]*)\}/)?.[1] || '';
        const panel = css.match(/\.linkPanel\s*\{([^}]*)\}/)?.[1] || '';

        expect(source).toContain('<div className={styles.linkPanels}>');
        expect(base).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
        expect(tablet).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
        expect(panel).toMatch(/min-width:\s*0/);
    });
});
