// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), 'packages/core/src/shared/components/settings', file), 'utf8');

describe('settings text and number inputs', () => {
    it('draw every number box with the shared Input, which takes the control height', () => {
        for (const file of ['SafetySection.jsx', 'PrivacySection.jsx', 'UndoSendRow.jsx', 'FeesSection.jsx']) {
            const source = read(file);
            expect(source, file).toMatch(/<Input\b/);
            expect(source, file).not.toMatch(/<input\b/);
        }
    });
});
