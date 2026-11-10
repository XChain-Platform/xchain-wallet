// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('retired confirm-session storage contract', () => {
    it('is not imported by the background host', () => {
        const source = readFileSync(
            'packages/extension/src/background/createBackgroundHost.js',
            'utf8',
        );
        expect(source).not.toContain('confirmActionSessionStorage');
        expect(source).not.toContain('ConfirmSession');
        expect(source).toContain('actionSafetySessionStorage');
    });
});
