// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
    vi.resetModules();
});

describe('popup error capture cleanup', () => {
    it('keeps a stale cleanup callback idempotent', async () => {
        const capture = await import('../../../packages/extension/src/popup/errorCapture.js');
        const target = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };

        const cleanup = capture.installShellErrorCapture(target);
        cleanup();
        cleanup();

        expect(target.removeEventListener).toHaveBeenCalledTimes(2);
    });
});
