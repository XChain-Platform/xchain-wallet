// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { XChainSDK } from '../../../packages/extension/src/background/sdkStatic.js';

it('exposes the real statically imported SDK constructor', () => {
    expect(XChainSDK).toEqual(expect.any(Function));
    expect(XChainSDK.name).toBe('XChainSDK');
});
