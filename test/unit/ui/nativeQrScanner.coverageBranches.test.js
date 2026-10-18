// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import {
    getNativeQrScanner,
    setNativeQrScanner,
} from '../../../packages/core/src/ui/nativeQrScanner.js';

afterEach(() => {
    setNativeQrScanner(null);
});

describe('native QR scanner registration branches', () => {
    it.each([
        {},
        { start: null },
        'scanner',
    ])('rejects a scanner without a callable start method', (scanner) => {
        expect(() => setNativeQrScanner(scanner)).toThrow(TypeError);
        expect(getNativeQrScanner()).toBeNull();
    });
});
