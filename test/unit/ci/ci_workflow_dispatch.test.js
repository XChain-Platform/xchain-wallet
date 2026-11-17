// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
const triggers = ci.slice(ci.indexOf('on:\n'), ci.indexOf('\nconcurrency:'));

describe('CI workflow triggers', () => {
    it('can be started manually when a develop push run is missing', () => {
        expect(triggers).toMatch(/^  workflow_dispatch:\s*$/m);
    });
});
