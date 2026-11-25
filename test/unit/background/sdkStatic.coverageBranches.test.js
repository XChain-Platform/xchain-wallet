// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sdkClassFromModule } from '../../../packages/extension/src/background/sdkStatic.js';

describe('static SDK export shape resolution', () => {
    it('uses a constructor nested under the default export', () => {
        class NestedSdk {}
        const module = {
            XChainSDK: undefined,
            default: { XChainSDK: NestedSdk },
        };

        expect(sdkClassFromModule(module)).toBe(NestedSdk);
    });

    it('uses a default constructor when named shapes are absent', () => {
        class DefaultSdk {}

        expect(sdkClassFromModule({ XChainSDK: undefined, default: DefaultSdk })).toBe(DefaultSdk);
    });
});
