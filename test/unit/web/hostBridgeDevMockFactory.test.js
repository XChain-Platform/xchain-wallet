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
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';

describe('hostBridge dev mock SDK factory', () => {
    it('exposes the action codec sections', () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-regtest' });

        expect(sdk).toEqual(expect.objectContaining({
            actions: expect.any(Object),
            decoder: expect.any(Object),
            encoder: expect.any(Object),
        }));
    });
});
