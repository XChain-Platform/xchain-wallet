// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it, vi } from 'vitest';

const { FakeXChainSDK } = vi.hoisted(() => ({
    FakeXChainSDK: class XChainSDK {},
}));

vi.mock('xchain-sdk', () => ({ XChainSDK: FakeXChainSDK }));

import { XChainSDK } from '../../../packages/extension/src/background/sdkStatic.js';

it('exposes the statically imported SDK constructor', () => {
    expect(XChainSDK).toBe(FakeXChainSDK);
});
