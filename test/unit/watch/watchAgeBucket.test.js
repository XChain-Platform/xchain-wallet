// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ageBucket } from '../../../packages/core/src/watch/watchFormat.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 10, 20, 12);

describe('ageBucket', () => {
    it.each([
        ['a future balance timestamp', NOW + MINUTE, 'justNow', 0, false],
        ['59 seconds', NOW - 59 * SECOND, 'justNow', 0, false],
        ['60 seconds', NOW - MINUTE, 'minutes', 1, false],
        ['exactly 15 minutes', NOW - 15 * MINUTE, 'minutes', 15, false],
        ['15 minutes plus 1 ms', NOW - 15 * MINUTE - 1, 'minutes', 15, true],
        ['59 minutes', NOW - 59 * MINUTE, 'minutes', 59, true],
        ['60 minutes', NOW - HOUR, 'hours', 1, true],
        ['23 hours 59 minutes', NOW - 23 * HOUR - 59 * MINUTE, 'hours', 23, true],
        ['24 hours', NOW - 24 * HOUR, 'day', 24, true],
    ])('classifies %s', (_label, balancesAt, bucket, n, amber) => {
        expect(ageBucket(balancesAt, NOW)).toEqual({ bucket, n, amber });
    });
});
