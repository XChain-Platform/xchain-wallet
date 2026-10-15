// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
    holdAutoLock,
    isAutoLockHeld,
} from '../../../packages/core/src/shared/hooks/autoLockGuard.js';

describe('autoLockGuard edge branches', () => {
    it('supports server use and ignores duplicate release calls', () => {
        const release = holdAutoLock();

        expect(isAutoLockHeld()).toBe(true);
        release();
        release();

        expect(isAutoLockHeld()).toBe(false);
    });
});
