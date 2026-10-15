// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    ApprovalRequiredError,
    UserRejectedError,
    rejectAllApprovals,
} from '../../../packages/extension/src/bridge/Approvals.js';

describe('default bridge approvals', () => {
    it.each([
        'connect',
        'signAction',
        'signMessage',
        'signPsbt',
        'coSign',
        'signIn',
    ])('rejects %s with a structured approval-required error', async (operation) => {
        const rejection = rejectAllApprovals[operation]({});

        await expect(rejection).rejects.toBeInstanceOf(ApprovalRequiredError);
        await expect(rejection).rejects.toMatchObject({
            name: 'ApprovalRequiredError',
            operation,
            code: 'USER_APPROVAL_REQUIRED',
        });
        await expect(rejection).rejects.toThrow(`user approval required for "${operation}"`);
    });
});

describe('bridge approval errors', () => {
    it('describes an explicit user rejection', () => {
        const error = new UserRejectedError('signMessage');

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
            name: 'UserRejectedError',
            operation: 'signMessage',
            code: 'USER_REJECTED',
            message: 'bridge: user rejected "signMessage"',
        });
    });
});
