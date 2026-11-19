// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// The wallet window store and the SDK policy evaluator must name the unresolved
// tick bucket identically: the evaluator reads the used total under its own
// constant, so a rename on either side silently turns a wildcard window cap
// back into a per-transaction cap. This reads the installed SDK's value.

import { describe, it, expect } from 'vitest';
import { UNRESOLVED_TICK_BUCKET } from '../../../packages/core/src/cosigner/vaultWindowStore.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

describe.skipIf(!sdkInstalled() && process.env.XCHAIN_REQUIRE_SIBLINGS !== '1')(
    'unresolved tick bucket parity with the SDK',
    () => {
        it('is byte-equal to the SDK policy evaluator bucket', () => {
            const sdkEvaluator = requireSdkDeep('policyEvaluator');
            expect(typeof sdkEvaluator.UNRESOLVED_TICK_BUCKET).toBe('string');
            expect(UNRESOLVED_TICK_BUCKET).toBe(sdkEvaluator.UNRESOLVED_TICK_BUCKET);
        });
    },
);
