// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('xchain-sdk');
    vi.resetModules();
});

describe('static SDK export shape resolution', () => {
    it('uses a constructor nested under the default export', async () => {
        class NestedSdk {}
        vi.doMock('xchain-sdk', () => ({
            XChainSDK: undefined,
            default: { XChainSDK: NestedSdk },
        }));

        const { XChainSDK } = await import('../../../packages/extension/src/background/sdkStatic.js');
        expect(XChainSDK).toBe(NestedSdk);
    });

    it('uses a default constructor when named shapes are absent', async () => {
        class DefaultSdk {}
        vi.doMock('xchain-sdk', () => ({ XChainSDK: undefined, default: DefaultSdk }));

        const { XChainSDK } = await import('../../../packages/extension/src/background/sdkStatic.js');
        expect(XChainSDK).toBe(DefaultSdk);
    });
});
