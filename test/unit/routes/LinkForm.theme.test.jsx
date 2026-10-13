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
        // styled by the shared error class, not an inline colour.
        expect(source).toContain('<StatusMessage variant="error" className={styles.error}>{submitError}</StatusMessage>');
        expect(source).not.toContain("color: '#ef5350'");
        const css = readFileSync(
            'packages/core/src/shared/routes/IssueTokenForm.module.css',
            'utf8',
        );
        expect(css).toMatch(/\.error \{[^}]*color: var\(--xc-danger-fg\)/);
    });
});
