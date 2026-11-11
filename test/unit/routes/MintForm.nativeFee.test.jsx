// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

describe('Mint native fee policy', () => {
    it('cannot request a native protocol-fee output from the form or flow', () => {
        const form = readFileSync(join(ROOT, 'packages/core/src/shared/routes/MintForm.jsx'), 'utf8');
        const flow = readFileSync(join(ROOT, 'packages/core/src/flows/mintToken.js'), 'utf8');

        expect(form).not.toContain('nativeFeeForFeelessAction');
        expect(form).not.toContain('payFeeInNativeCoin');
        expect(flow).not.toContain('payFeeInNativeCoin');
    });
});
