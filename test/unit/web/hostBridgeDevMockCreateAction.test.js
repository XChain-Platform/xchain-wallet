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

    it('builds and serializes the create-poll input used by vote confirmation', () => {
        const sdk = __createDevMockSdkForTests({ chainId: 'bitcoin-regtest' });
        const params = sdk.voting.createPollParams({
            tick: 'VOTE',
            question: 'Ship it?',
            options: ['Yes', 'No'],
            endBlock: '950000',
            maxSelections: '1',
            tallyMode: 'approval',
            weightMode: 'balance',
            minVoters: '1',
        });

        expect(params).toEqual({
            version: 0,
            tick: 'VOTE',
            endBlock: '950000',
            options: 'Yes,No',
            maxSelections: '1',
            tallyMode: 'approval',
            weightMode: 'balance',
            minVoters: '1',
            question: 'Ship it?',
        });
        expect(sdk.actions.createAction({ action: 'VOTE', params }).actionString)
            .toBe('VOTE|0|VOTE|950000|Yes,No|1|approval|balance||1|||Ship it?');
    });
});
