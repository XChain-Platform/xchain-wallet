// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/MultisigCosignerShare.module.css', 'utf8');
const source = readFileSync('packages/core/src/shared/routes/MultisigCosignerShare.jsx', 'utf8');
const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');

describe('Share Wallet as Co-Signer spacing', () => {
    it('keeps exactly 8px from the address field or its error to Share', () => {
        const rule = /\.shareActionStack\s*\{([\s\S]*?)\}/.exec(css)?.[1] || '';

        expect(tokens).toMatch(/--xc-space-2:\s*8px;/);
        expect(rule).toMatch(/display:\s*flex;/);
        expect(rule).toMatch(/flex-direction:\s*column;/);
        expect(rule).toMatch(/gap:\s*var\(--xc-space-2\);/);
        expect(source).toMatch(/<div className=\{local\.shareActionStack\}>[\s\S]*?<AddressField[\s\S]*?<Button[\s\S]*?<\/div>/);
    });
});
