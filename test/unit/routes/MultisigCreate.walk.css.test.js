// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('packages/core/src/shared/routes/MultisigCreate.module.css', 'utf8');

describe('MultisigCreate walk layout', () => {
    it('keeps Add Cosigner exactly 8px above Create Multisig', () => {
        expect(css).toMatch(/\.mainActions\s*\{[^}]*gap:\s*8px;/s);
    });
});
