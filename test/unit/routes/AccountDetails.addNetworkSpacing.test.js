// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/AccountDetails.module.css', 'utf8');
const source = readFileSync('packages/core/src/shared/routes/AccountDetails.jsx', 'utf8');

describe('Account Details Add a Network spacing', () => {
    it('puts the group spacing above the label and uses the standard label gap below it', () => {
        const rule = /\.addNetworkSection\s*\{([\s\S]*?)\}/.exec(css)?.[1] || '';

        expect(rule).toMatch(/margin-top:\s*var\(--xc-space-2\);/);
        expect(rule).toMatch(/gap:\s*var\(--xc-space-1\);/);
        expect(rule).not.toMatch(/margin-bottom:\s*var\(--xc-space-2\);/);
    });

    it('applies the spacing classes to the address groups', () => {
        expect(source).toContain('className={styles.addresses} data-account-addresses=""');
        expect(source).toContain('<section className={styles.addNetworkSection}>');
    });
});
