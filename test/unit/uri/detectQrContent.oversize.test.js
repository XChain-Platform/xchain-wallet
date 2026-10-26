// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Classifying pasted or scanned text stays linear in its length. A private key
// is a few dozen characters, so a long base58-looking run is never handed to
// the quadratic key decoder.

import { describe, expect, it } from 'vitest';
import { detectQrContent } from '../../../packages/core/src/uri/detectQrContent.js';

describe('detectQrContent on oversize text', () => {
    it.each([
        ['an alphanumeric run', 'a'.repeat(60_000)],
        ['a base58 run', 'Kx'.repeat(30_000)],
        ['an odd-length hex run', 'ab'.repeat(30_000)],
    ])('classifies %s quickly', (_name, text) => {
        const started = performance.now();
        expect(detectQrContent(text).type).toBe('unknown');
        expect(performance.now() - started).toBeLessThan(1000);
    });
});
