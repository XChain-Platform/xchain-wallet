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

describe('hostBridge dev mock createAction', () => {
    it('preserves BROADCAST fields in the action string', () => {
        const sdk = __createDevMockSdkForTests({ chainId: 'bitcoin-regtest' });
        const result = sdk.actions.createAction({
            action: 'BROADCAST',
            params: { VERSION: '2', MESSAGE: 'hello', FEE: '1.5', MEMO: 'm' },
        });

        expect(result.actionString).toBe('BROADCAST|2|hello|1.5|m');
    });
});
