// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../../packages/extension/src/shared/chromeMessaging.js', () => ({
    sendMessage: mocks.sendMessage,
}));

const { resolveApproval } = await import(
    '../../../packages/extension/src/approval/messaging.js'
);

describe('approval messaging success branches', () => {
    it('returns the broker response when the approval settles', async () => {
        const response = { resolved: true };
        mocks.sendMessage.mockResolvedValue(response);

        await expect(resolveApproval('request-1', { approved: true }))
            .resolves.toBe(response);
        expect(mocks.sendMessage).toHaveBeenCalledWith('approval.resolve', {
            id: 'request-1',
            result: { approved: true },
        });
    });
});
