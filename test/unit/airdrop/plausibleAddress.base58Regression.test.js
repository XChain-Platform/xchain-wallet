// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isPlausibleAddress } from '../../../packages/core/src/airdrop/parseRecipients.js';

describe('isPlausibleAddress Base58 validation', () => {
    // BUG: The broad lowercase alphabet check accepts zero in legacy-length Base58 candidates.
    it.skip('rejects Base58-forbidden characters in a legacy-length candidate', () => {
        expect(isPlausibleAddress(`1${'A'.repeat(24)}0`)).toBe(false);
    });
});
