// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { createSignThrottle } from '../../packages/core/src/flows/signThrottle.js';

describe('security/sign-throttle/rate-limit-order', () => {
    it('does not let refused requests from one origin block another origin', () => {
        const throttle = createSignThrottle({
            burst: 2,
            windowMs: 60_000,
            now: () => 1_000_000,
        });
        const saturatedOrigin = 'https://saturated.example';
        const independentOrigin = 'https://independent.example';

        expect(throttle.check(saturatedOrigin).allowed).toBe(true);
        expect(throttle.check(saturatedOrigin).allowed).toBe(true);
        expect(throttle.check(saturatedOrigin).allowed).toBe(false);
        expect(throttle.check(independentOrigin).allowed).toBe(true);
        expect(throttle.check(saturatedOrigin).allowed).toBe(false);
    });
});
