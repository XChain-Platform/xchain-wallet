// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { newWatchRequestId } from '../../../packages/core/src/watch/buildWatchRequest.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('newWatchRequestId', () => {
    it('encodes bytes 0 through 15 as lowercase hex', () => {
        const id = newWatchRequestId((bytes) => {
            bytes.set(Array.from({ length: 16 }, (_, index) => index));
        });

        expect(id).toBe('000102030405060708090a0b0c0d0e0f');
    });

    it('encodes bytes of 255 as two hex characters each', () => {
        const id = newWatchRequestId((bytes) => bytes.fill(255));

        expect(id).toBe('f'.repeat(32));
    });

    it('returns a 32-character lowercase hex ID by default', () => {
        expect(newWatchRequestId()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('returns different IDs across default calls', () => {
        expect(newWatchRequestId()).not.toBe(newWatchRequestId());
    });

    it('throws a TypeError when no random source is available', () => {
        vi.stubGlobal('crypto', {});

        expect(() => newWatchRequestId()).toThrow(TypeError);
    });
});
